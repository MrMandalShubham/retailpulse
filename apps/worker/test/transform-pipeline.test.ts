/**
 * End-to-end transform pipeline test over fixture HTML with in-memory fakes —
 * no Postgres, no object storage, no network. Also exercises processDocument
 * directly for extraction/classification/observation assertions.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RawStorageAdapter } from "@dip/domain";
import {
  processDocument,
  runTransformCycle,
  type EligibleRawDocument,
  type MasterData,
  type ObservationDraft,
  type StagedProductDraft,
  type TransformRepo,
} from "../src/transform/pipeline.js";
import { createRuleEngine, type RuleRow } from "../src/transform/normalize/rule-engine.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

const PRODUCT_HTML = fixture("product-page.html");
const LISTING_HTML = fixture("listing-page.html");
const JUNK_HTML = fixture("junk-page.html");

const EMPTY_MASTER: MasterData = { brands: [], categories: [], productTypes: [] };

let ruleId = 1;
const rule = (partial: Partial<RuleRow> & Pick<RuleRow, "ruleType" | "matchKey">): RuleRow => ({
  id: `r-${ruleId++}`,
  sourceScope: "global",
  matchValue: null,
  normalizedKey: null,
  normalizedValue: null,
  priority: 100,
  active: true,
  ...partial,
});

const STARTER_RULES: RuleRow[] = [
  rule({ ruleType: "currency_hint", matchKey: "$", normalizedValue: "USD" }),
  rule({ ruleType: "brand_alias", matchKey: "cosrx", normalizedValue: "COSRX" }),
  rule({ ruleType: "ignore_pattern", matchKey: "/login" }),
];

const doc = (id: string, url: string): EligibleRawDocument => ({
  id,
  sourceId: "src-1",
  sourceSlug: "test-store",
  url,
  storageKey: `raw/test-store/${id}.html`,
});

describe("processDocument", () => {
  const engine = createRuleEngine(STARTER_RULES, "test-store");

  it("stages a product page with deterministic extraction and normalized payload", () => {
    const result = processDocument(
      doc("d1", "https://shop.test/product/snail-essence"),
      PRODUCT_HTML,
      engine,
      EMPTY_MASTER,
    );

    expect(result.staged).not.toBeNull();
    const staged = result.staged as StagedProductDraft;
    expect(staged.pageType).toBe("product");
    expect(staged.dominantSignal).toBe("jsonld_product");
    expect(staged.extractedName).toBe("Advanced Snail 96 Mucin Power Essence 100ml");
    // brand_alias rule normalized "cosrx" -> "COSRX" without AI.
    expect(staged.extractedBrand).toBe("COSRX");
    expect(staged.extractedCurrency).toBe("USD");
    expect(staged.primaryImageUrl).toBe(
      "https://img.example-store.test/products/snail-essence.jpg",
    );
    expect(staged.extractionMethod).toBe("jsonld");

    const payload = staged.normalizedPayload as { price: { value: number; currency: string } };
    expect(payload.price.value).toBe(21.99);
    expect(payload.price.currency).toBe("USD");

    // name/brand/price agree across methods -> high confidence, valid record.
    expect(Number(staged.confidenceScore)).toBeGreaterThanOrEqual(0.7);
    expect(staged.validationStatus).toBe("valid");
    expect(staged.unresolvedFields).not.toContain("name");
    expect(staged.fieldConfidences.name).toBeGreaterThan(0.9);
  });

  it("emits unknown_product_type observation when no rule matches", () => {
    const result = processDocument(
      doc("d1", "https://shop.test/product/snail-essence"),
      PRODUCT_HTML,
      engine,
      EMPTY_MASTER,
    );
    const types = result.observations.map((o) => o.observationType);
    expect(types).toContain("unknown_product_type");
  });

  it("classifies a listing page and produces an observation, not a staged row", () => {
    const result = processDocument(
      doc("d2", "https://shop.test/display/category/essence"),
      LISTING_HTML,
      engine,
      EMPTY_MASTER,
    );
    expect(result.staged).toBeNull();
    expect(result.observations).toHaveLength(1);
    const observation = result.observations[0] as ObservationDraft;
    expect(observation.observationType).toBe("unseen_pattern");
    expect(observation.suggestedValue).toBe("listing");
  });

  it("classifies a junk page as non-product with no staged row", () => {
    const result = processDocument(
      doc("d3", "https://shop.test/support"),
      JUNK_HTML,
      engine,
      EMPTY_MASTER,
    );
    expect(result.staged).toBeNull();
    expect(result.observations[0]?.suggestedValue).toBe("non_product");
  });

  it("records unknown_brand with a fuzzy suggestion when master data is close", () => {
    const noAliasEngine = createRuleEngine(
      STARTER_RULES.filter((r) => r.ruleType !== "brand_alias"),
      "test-store",
    );
    const master: MasterData = { brands: ["COSRX Official"], categories: [], productTypes: [] };
    const result = processDocument(
      doc("d4", "https://shop.test/product/snail-essence"),
      PRODUCT_HTML,
      noAliasEngine,
      master,
    );
    const brandObs = result.observations.find((o) => o.observationType === "unknown_brand");
    expect(brandObs).toBeDefined();
    expect(brandObs?.rawValue?.toLowerCase()).toBe("cosrx");
    expect(brandObs?.suggestedValue).toBe("COSRX Official");
  });
});

interface FakeState {
  repo: TransformRepo;
  staged: Array<StagedProductDraft & { runId: string; id: string }>;
  observations: Array<ObservationDraft & { runId: string; stagedProductId: string | null }>;
  runs: Array<{ id: string; status: string; counters?: unknown }>;
  deletedFor: string[][];
}

function makeFakeRepo(
  documents: EligibleRawDocument[],
  rules: RuleRow[],
  master: MasterData,
): FakeState {
  const state: FakeState = {
    staged: [],
    observations: [],
    runs: [],
    deletedFor: [],
    repo: undefined as unknown as TransformRepo,
  };
  let nextStaged = 1;
  state.repo = {
    listEligibleRawDocuments: async () => documents,
    deleteStagedForRawDocuments: async (ids) => void state.deletedFor.push(ids),
    createRun: async () => {
      const run = { id: `run-${state.runs.length + 1}`, status: "pending" };
      state.runs.push(run);
      return { id: run.id };
    },
    markRunRunning: async (runId) => {
      const run = state.runs.find((r) => r.id === runId);
      if (run) run.status = "running";
    },
    finishRun: async (runId, status, counters) => {
      const run = state.runs.find((r) => r.id === runId);
      if (run) {
        run.status = status;
        run.counters = counters;
      }
    },
    insertStagedProduct: async (runId, draft) => {
      const id = `staged-${nextStaged++}`;
      state.staged.push({ ...draft, runId, id });
      return { id };
    },
    insertObservations: async (runId, stagedProductId, drafts) => {
      for (const draft of drafts) {
        state.observations.push({ ...draft, runId, stagedProductId });
      }
    },
    loadActiveRules: async () => rules,
    loadMasterData: async () => master,
  };
  return state;
}

function makeStorage(objects: Record<string, string>): RawStorageAdapter {
  return {
    put: async () => {},
    get: async (key) => {
      const html = objects[key];
      if (html === undefined) throw new Error(`missing object ${key}`);
      return new TextEncoder().encode(html);
    },
    exists: async (key) => objects[key] !== undefined,
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

describe("runTransformCycle (end-to-end with fakes)", () => {
  it("processes mixed documents: stages products, observes listings, skips ignored urls", async () => {
    const documents = [
      doc("d1", "https://shop.test/product/snail-essence"),
      doc("d2", "https://shop.test/display/category/essence"),
      doc("d3", "https://shop.test/login?next=/"),
    ];
    const state = makeFakeRepo(documents, STARTER_RULES, EMPTY_MASTER);
    const storage = makeStorage({
      "raw/test-store/d1.html": PRODUCT_HTML,
      "raw/test-store/d2.html": LISTING_HTML,
      // d3 never reaches storage: ignore_pattern short-circuits first.
    });

    const summary = await runTransformCycle({
      repo: state.repo,
      storage,
      logger: silentLogger,
      maxDocuments: 100,
      reprocess: false,
    });

    expect(summary).toMatchObject({
      totalDocuments: 3,
      processedDocuments: 3,
      succeededDocuments: 3,
      failedDocuments: 0,
      stagedProducts: 1,
      ignoredDocuments: 1,
    });
    expect(state.runs[0]?.status).toBe("succeeded");
    expect(state.staged[0]?.extractedBrand).toBe("COSRX");
    // The staged product's observations are linked to it; listing observation is not.
    const attached = state.observations.filter((o) => o.stagedProductId === "staged-1");
    expect(attached.length).toBeGreaterThan(0);
    const listingObs = state.observations.find((o) => o.observationType === "unseen_pattern");
    expect(listingObs?.stagedProductId).toBeNull();
  });

  it("clears prior staged output when reprocessing", async () => {
    const documents = [doc("d1", "https://shop.test/product/snail-essence")];
    const state = makeFakeRepo(documents, STARTER_RULES, EMPTY_MASTER);
    const storage = makeStorage({ "raw/test-store/d1.html": PRODUCT_HTML });

    await runTransformCycle({
      repo: state.repo,
      storage,
      logger: silentLogger,
      maxDocuments: 100,
      reprocess: true,
    });
    expect(state.deletedFor).toEqual([["d1"]]);
  });

  it("counts storage failures as failed documents and fails the run when nothing succeeds", async () => {
    const documents = [doc("d1", "https://shop.test/product/snail-essence")];
    const state = makeFakeRepo(documents, STARTER_RULES, EMPTY_MASTER);
    const storage = makeStorage({}); // every get throws

    const summary = await runTransformCycle({
      repo: state.repo,
      storage,
      logger: silentLogger,
      maxDocuments: 100,
      reprocess: false,
    });
    expect(summary.failedDocuments).toBe(1);
    expect(state.runs[0]?.status).toBe("failed");
  });
});
