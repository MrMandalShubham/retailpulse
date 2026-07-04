/**
 * Fake end-to-end ingestion test: a local HTTP stub server stands in for the
 * external site, and in-memory fakes stand in for Postgres and object storage.
 * Proves the full "fetch -> store raw -> record metadata" flow without
 * touching real external sites (CI-safe).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RawStorageAdapter } from "@dip/domain";
import { fetchUrl } from "../src/ingestion/fetcher.js";
import {
  runIngestionCycle,
  type IngestionRepo,
  type NewRawDocumentInput,
  type PipelineSource,
} from "../src/ingestion/pipeline.js";

const HTML_BODY = "<html><body>hello dip</body></html>";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/page")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HTML_BODY);
    } else if (req.url === "/boom") {
      res.writeHead(500);
      res.end("server error");
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => void server.close(() => resolve())));

interface FakeState {
  repo: IngestionRepo;
  jobs: Array<{ id: string; sourceId: string; status: string; errorMessage: string | null }>;
  docs: NewRawDocumentInput[];
}

function makeFakeRepo(sources: PipelineSource[]): FakeState {
  const state: FakeState = { jobs: [], docs: [], repo: undefined as unknown as IngestionRepo };
  let nextJob = 1;
  state.repo = {
    listEnabledSources: async () => sources,
    createCrawlJob: async (sourceId) => {
      const job = { id: `job-${nextJob++}`, sourceId, status: "pending", errorMessage: null };
      state.jobs.push(job);
      return { id: job.id };
    },
    markJobRunning: async (jobId) => {
      const job = state.jobs.find((j) => j.id === jobId);
      if (job) job.status = "running";
    },
    markJobFinished: async (jobId, status, errorMessage) => {
      const job = state.jobs.find((j) => j.id === jobId);
      if (job) {
        job.status = status;
        job.errorMessage = errorMessage ?? null;
      }
    },
    insertRawDocument: async (doc) => {
      state.docs.push(doc);
    },
  };
  return state;
}

function makeFakeStorage(): { adapter: RawStorageAdapter; objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    adapter: {
      put: async (key, body) => void objects.set(key, body),
      get: async (key) => {
        const found = objects.get(key);
        if (!found) throw new Error(`missing object ${key}`);
        return found;
      },
      exists: async (key) => objects.has(key),
    },
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

const testFetch = (url: string) => fetchUrl(url, { timeoutMs: 3_000, retries: 0 });

describe("runIngestionCycle", () => {
  it("stores ok pages in storage and records metadata; failed URLs get error rows", async () => {
    const state = makeFakeRepo([
      { id: "src-1", slug: "stub-site", name: "Stub", seedUrls: [`${baseUrl}/page`, `${baseUrl}/missing`] },
    ]);
    const storage = makeFakeStorage();

    const summary = await runIngestionCycle({
      repo: state.repo,
      storage: storage.adapter,
      fetchUrl: testFetch,
      logger: silentLogger,
    });

    expect(summary).toMatchObject({
      sourcesProcessed: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
      documentsOk: 1,
      documentsFailed: 1,
    });
    expect(state.jobs[0]?.status).toBe("succeeded");

    const okDoc = state.docs.find((d) => d.status === "ok");
    expect(okDoc?.httpStatus).toBe(200);
    expect(okDoc?.contentType).toContain("text/html");
    expect(okDoc?.responseBytes).toBe(Buffer.byteLength(HTML_BODY));
    expect(okDoc?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(okDoc?.storageKey).toMatch(/^raw\/stub-site\/\d{4}-\d{2}-\d{2}\/job-1\/[0-9a-f]{16}\.html$/);
    // The payload really landed in storage under the recorded key.
    expect(storage.objects.get(okDoc!.storageKey!)).toBeDefined();

    const errorDoc = state.docs.find((d) => d.status === "error");
    expect(errorDoc?.httpStatus).toBe(404);
    expect(errorDoc?.storageKey).toBeNull();
    expect(errorDoc?.errorMessage).toContain("404");
  });

  it("marks the job failed when every fetch fails", async () => {
    const state = makeFakeRepo([
      { id: "src-1", slug: "stub-site", name: "Stub", seedUrls: [`${baseUrl}/boom`] },
    ]);
    const storage = makeFakeStorage();

    const summary = await runIngestionCycle({
      repo: state.repo,
      storage: storage.adapter,
      fetchUrl: testFetch,
      logger: silentLogger,
    });

    expect(summary.jobsFailed).toBe(1);
    expect(state.jobs[0]?.status).toBe("failed");
    expect(state.jobs[0]?.errorMessage).toContain("all 1 fetches failed");
    expect(storage.objects.size).toBe(0);
  });

  it("caps fetches at 5 seed URLs per job (application rule)", async () => {
    const seedUrls = Array.from({ length: 7 }, (_, i) => `${baseUrl}/page?n=${i}`);
    const state = makeFakeRepo([{ id: "src-1", slug: "stub-site", name: "Stub", seedUrls }]);
    const storage = makeFakeStorage();

    const summary = await runIngestionCycle({
      repo: state.repo,
      storage: storage.adapter,
      fetchUrl: testFetch,
      logger: silentLogger,
    });

    expect(summary.documentsOk).toBe(5);
    expect(state.docs).toHaveLength(5);
    expect(storage.objects.size).toBe(5);
  });

  it("skips sources without seed URLs and creates no job", async () => {
    const state = makeFakeRepo([{ id: "src-1", slug: "empty", name: "Empty", seedUrls: [] }]);
    const storage = makeFakeStorage();

    const summary = await runIngestionCycle({
      repo: state.repo,
      storage: storage.adapter,
      fetchUrl: testFetch,
      logger: silentLogger,
    });

    expect(summary.sourcesSkipped).toBe(1);
    expect(state.jobs).toHaveLength(0);
  });
});
