/**
 * Monitoring queries — all generated from the config layer. Table/column names
 * come only from CORE_TABLES / PHASES (trusted constants), never from request
 * input, so string interpolation here is injection-safe.
 */
import { CORE_TABLES, PHASES, THRESHOLDS, type TableMonitor } from "./config.js";

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const n = (v: unknown): number => Number(v ?? 0);
const q = (id: string): string => `"${id.replace(/"/g, "")}"`; // quote identifier

function createdAtCol(cfg: TableMonitor): string | null {
  if (cfg.createdAtColumn === null) return null;
  return cfg.createdAtColumn ?? "created_at";
}

export interface ColumnNull {
  column: string;
  nulls: number;
  nullPct: number;
}
export interface TableHealth {
  table: string;
  label: string;
  layer: string;
  core: boolean;
  rowCount: number;
  latestInsert: string | null;
  duplicateCount: number | null;
  columns: ColumnNull[];
}

export async function tableHealth(pool: Queryable, cfg: TableMonitor): Promise<TableHealth> {
  const ccol = createdAtCol(cfg);
  const parts = [`count(*)::bigint as _total`];
  if (ccol) parts.push(`max(${q(ccol)}) as _latest`);
  for (const c of cfg.importantColumns) parts.push(`count(${q(c)})::bigint as ${q(c)}`);
  const row = (await pool.query(`select ${parts.join(", ")} from ${q(cfg.table)}`)).rows[0] ?? {};
  const total = n(row._total);

  const columns: ColumnNull[] = cfg.importantColumns.map((c) => {
    const nulls = total - n(row[c]);
    return { column: c, nulls, nullPct: total ? Math.round((nulls / total) * 1000) / 10 : 0 };
  });

  let duplicateCount: number | null = null;
  if (cfg.dedupKey && total > 0) {
    const keys = cfg.dedupKey.map(q).join(", ");
    const dup = (
      await pool.query(
        `select coalesce(count(*),0)::bigint as d from (select 1 from ${q(cfg.table)} group by ${keys} having count(*) > 1) x`,
      )
    ).rows[0];
    duplicateCount = n(dup?.d);
  }

  return {
    table: cfg.table,
    label: cfg.label,
    layer: cfg.layer,
    core: Boolean(cfg.core),
    rowCount: total,
    latestInsert: ccol ? ((row._latest as string | null) ?? null) : null,
    duplicateCount,
    columns,
  };
}

export async function allTableHealth(pool: Queryable): Promise<TableHealth[]> {
  return Promise.all(CORE_TABLES.map((c) => tableHealth(pool, c)));
}

export async function tableRecords(
  pool: Queryable,
  table: string,
  mode: "latest" | "suspicious",
  limit: number,
): Promise<{ table: string; mode: string; records: Array<Record<string, unknown>> }> {
  const cfg = CORE_TABLES.find((c) => c.table === table);
  if (!cfg) throw new Error(`unknown table '${table}'`);
  const ccol = createdAtCol(cfg);
  const order = ccol ? `order by ${q(ccol)} desc` : "";
  let where = "";
  if (mode === "suspicious") {
    // Rows missing any business-critical field.
    const conds = cfg.importantColumns.map((c) => `${q(c)} is null`);
    where = conds.length ? `where ${conds.join(" or ")}` : "";
  }
  const rows = (
    await pool.query(
      `select * from ${q(cfg.table)} ${where} ${order} limit ${Math.min(limit, 100)}`,
    )
  ).rows;
  return { table, mode, records: rows };
}

export interface PhaseStatus {
  id: number;
  key: string;
  name: string;
  runTable: string | null;
  lastRunStatus: string | null;
  runs: number;
  succeededRuns: number;
  failedRuns: number;
  processed: number;
  failed: number;
  outputRows: number;
  avgSeconds: number | null;
}

export async function phaseStatuses(pool: Queryable): Promise<PhaseStatus[]> {
  const out: PhaseStatus[] = [];
  for (const p of PHASES) {
    const outputRows = n(
      (await pool.query(`select count(*)::bigint as c from ${q(p.outputTable)}`)).rows[0]?.c,
    );
    let runs = 0,
      succeededRuns = 0,
      failedRuns = 0,
      processed = 0,
      failed = 0;
    let lastRunStatus: string | null = null;
    let avgSeconds: number | null = null;

    if (p.runTable) {
      const agg = (
        await pool.query(
          `select count(*)::int as runs,
             count(*) filter (where ${q(p.statusColumn)}='succeeded')::int as ok,
             count(*) filter (where ${q(p.statusColumn)}='failed')::int as failed_runs,
             ${p.processedColumn ? `coalesce(sum(${q(p.processedColumn)}),0)::int` : "0"} as processed,
             ${p.failedColumn ? `coalesce(sum(${q(p.failedColumn)}),0)::int` : "0"} as failed,
             avg(extract(epoch from (${q(p.finishedColumn)} - ${q(p.startedColumn)})))::float as avg_secs
           from ${q(p.runTable)}`,
        )
      ).rows[0];
      runs = n(agg?.runs);
      succeededRuns = n(agg?.ok);
      failedRuns = n(agg?.failed_runs);
      processed = n(agg?.processed);
      failed = n(agg?.failed);
      avgSeconds = agg?.avg_secs != null ? Math.round(n(agg.avg_secs) * 10) / 10 : null;
      const last = (
        await pool.query(
          `select ${q(p.statusColumn)} as s from ${q(p.runTable)} order by created_at desc limit 1`,
        )
      ).rows[0];
      lastRunStatus = (last?.s as string | null) ?? null;
      if (p.key === "raw_ingestion") processed = outputRows; // crawl_jobs has no doc counters
    } else {
      processed = outputRows; // search layer: no run table
    }

    out.push({
      id: p.id,
      key: p.key,
      name: p.name,
      runTable: p.runTable,
      lastRunStatus,
      runs,
      succeededRuns,
      failedRuns,
      processed,
      failed,
      outputRows,
      avgSeconds,
    });
  }
  return out;
}

/** Named "stuck between phases" / integrity checks. */
export async function dataQuality(pool: Queryable) {
  const scalar = async (label: string, sqlText: string, hint: string) => ({
    check: label,
    count: n((await pool.query(sqlText)).rows[0]?.c),
    hint,
  });

  const checks = await Promise.all([
    scalar(
      "raw_ok_unstaged",
      `select count(*)::bigint c from raw_documents r where r.status='ok' and r.content_type ilike '%html%'
        and not exists (select 1 from staged_products s where s.raw_document_id=r.id)`,
      "OK raw HTML docs never transformed into staging",
    ),
    scalar(
      "staged_valid_unpromoted",
      `select count(*)::bigint c from staged_products s where s.validation_status='valid'
        and not exists (select 1 from promotion_items p where p.staged_product_id=s.id)`,
      "Valid staged products never sent through promotion",
    ),
    scalar(
      "products_without_source",
      `select count(*)::bigint c from products_master p
        where not exists (select 1 from product_sources ps where ps.product_id=p.id)`,
      "Canonical products with no provenance link (should be 0)",
    ),
    scalar(
      "products_without_price_fact",
      `select count(*)::bigint c from products_master p
        where not exists (select 1 from product_price_facts f where f.product_id=p.id)`,
      "Canonical products with no price history yet",
    ),
    scalar(
      "incomplete_canonical",
      `select count(*)::bigint c from products_master
        where brand_id is null or category_id is null or product_type_id is null`,
      "Canonical products missing brand/category/type",
    ),
    scalar(
      "ai_items_failed",
      `select count(*)::bigint c from ai_review_items where status='failed'`,
      "AI review items that errored (malformed output / provider failure)",
    ),
    scalar(
      "open_ai_suggestions",
      `select count(*)::bigint c from ai_rule_suggestions where status='open'`,
      "AI rule suggestions awaiting operator approval",
    ),
  ]);

  const tables = await allTableHealth(pool);
  const nullHotspots = tables
    .flatMap((t) => t.columns.map((c) => ({ table: t.table, ...c })))
    .filter((c) => c.nullPct > 0)
    .sort((a, b) => b.nullPct - a.nullPct);
  const duplicates = tables
    .filter((t) => (t.duplicateCount ?? 0) > 0)
    .map((t) => ({ table: t.table, duplicates: t.duplicateCount }));

  return { checks, nullHotspots, duplicates };
}

/** Run-over-run AI quality — is the system actually improving? */
export async function aiQuality(pool: Queryable) {
  const reviewRuns = (
    await pool.query(
      `select r.id, r.created_at, r.provider_name, r.model_name, r.status,
              r.total_items, r.succeeded_items, r.failed_items,
              (select count(*)::int from ai_rule_suggestions s
                 join ai_review_items i on i.id=s.ai_review_item_id where i.ai_review_run_id=r.id) as suggestions
       from ai_review_runs r order by r.created_at desc limit 20`,
    )
  ).rows;

  // Transform trend: per run, how much came out clean (valid%) and how many
  // fields were left unresolved (null-reduction proxy). Improvement = valid% up,
  // unresolved down, observations-per-product down.
  const transformTrend = (
    await pool.query(
      `select tr.id, tr.created_at, count(sp.id)::int as staged,
              count(*) filter (where sp.validation_status='valid')::int as valid,
              count(*) filter (where sp.validation_status='needs_review')::int as needs_review,
              round(avg(sp.confidence_score),3) as avg_confidence,
              round(avg(coalesce(array_length(sp.unresolved_fields,1),0)),2) as avg_unresolved,
              (select count(*)::int from transform_observations o where o.transform_run_id=tr.id) as observations
       from transform_runs tr left join staged_products sp on sp.transform_run_id=tr.id
       group by tr.id, tr.created_at order by tr.created_at desc limit 20`,
    )
  ).rows;

  const promotionTrend = (
    await pool.query(
      `select id, created_at, total_items, promoted_new, matched_existing, failed_items
       from promotion_runs order by created_at desc limit 20`,
    )
  ).rows;

  const rules = (
    await pool.query(
      `select count(*)::int as total,
              count(*) filter (where learned_from_ai)::int as learned_from_ai,
              count(*) filter (where active)::int as active
       from normalization_rules`,
    )
  ).rows[0];

  return { reviewRuns, transformTrend, promotionTrend, rules };
}

/** Unified run timeline across every phase's run/audit table. */
export async function runHistory(pool: Queryable, limit: number) {
  const rows = (
    await pool.query(
      `(select 'ingestion' as phase, id::text, created_at, started_at, finished_at, status,
               null::int as input, null::int as processed, null::int as failed, null::text as note from crawl_jobs)
       union all
       (select 'transform', id::text, created_at, started_at, finished_at, status,
               total_documents, processed_documents, failed_documents, error_message from transform_runs)
       union all
       (select 'ai_review', id::text, created_at, started_at, finished_at, status,
               total_items, processed_items, failed_items, error_message from ai_review_runs)
       union all
       (select 'promotion', id::text, created_at, started_at, finished_at, status,
               total_items, (promoted_new + matched_existing), failed_items, error_message from promotion_runs)
       union all
       (select 'facts', id::text, created_at, started_at, finished_at, status,
               products_considered, (price_facts_inserted + rating_facts_inserted), skipped_invalid, error_message from fact_runs)
       order by created_at desc limit ${Math.min(limit, 200)}`,
    )
  ).rows;
  return rows;
}

/** Derived alert center. */
export async function alerts(pool: Queryable) {
  const items: Array<{
    level: "critical" | "warning" | "info";
    category: string;
    message: string;
  }> = [];
  const push = (level: "critical" | "warning" | "info", category: string, message: string) =>
    items.push({ level, category, message });

  const tables = await allTableHealth(pool);
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.nullPct >= THRESHOLDS.nullRatePctCrit)
        push("critical", "null_rate", `${t.table}.${c.column} is ${c.nullPct}% null`);
      else if (c.nullPct >= THRESHOLDS.nullRatePctWarn)
        push("warning", "null_rate", `${t.table}.${c.column} is ${c.nullPct}% null`);
    }
    if ((t.duplicateCount ?? 0) >= THRESHOLDS.duplicateWarn)
      push("warning", "duplicates", `${t.table} has ${t.duplicateCount} duplicate business keys`);
  }

  const phases = await phaseStatuses(pool);
  for (const p of phases) {
    if (p.failedRuns > 0)
      push("warning", "failed_runs", `${p.name}: ${p.failedRuns} failed run(s)`);
    if (p.lastRunStatus === "failed") push("critical", "failed_runs", `${p.name}: last run FAILED`);
  }

  const dq = await dataQuality(pool);
  for (const c of dq.checks) {
    if (c.check === "products_without_source" && c.count > 0)
      push("critical", "integrity", `${c.count} canonical products with no provenance link`);
    if (c.check === "staged_valid_unpromoted" && c.count >= THRESHOLDS.stuckRecordsWarn)
      push("warning", "stuck", `${c.count} valid staged products not yet promoted`);
    if (c.check === "raw_ok_unstaged" && c.count >= THRESHOLDS.stuckRecordsWarn)
      push("warning", "stuck", `${c.count} raw docs not yet transformed`);
    if (c.check === "ai_items_failed" && c.count > 0)
      push("warning", "ai", `${c.count} AI review items failed (check output quality)`);
  }

  // AI degradation: latest review run failed% worse than the prior one.
  const aq = await aiQuality(pool);
  if (aq.reviewRuns.length >= 2) {
    const rate = (r: Record<string, unknown>) =>
      n(r.total_items) ? n(r.failed_items) / n(r.total_items) : 0;
    const [latest, prev] = aq.reviewRuns;
    if (latest && prev && rate(latest) > rate(prev) && rate(latest) > 0.1)
      push(
        "warning",
        "ai",
        `AI failure rate rose to ${Math.round(rate(latest) * 100)}% in the latest run`,
      );
  }

  const order = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return items;
}

export async function overview(pool: Queryable) {
  const one = async (sqlText: string) => n((await pool.query(sqlText)).rows[0]?.c);
  const [
    products,
    brands,
    categories,
    types,
    markets,
    priceFacts,
    ratingFacts,
    openObs,
    openSug,
    staged,
  ] = await Promise.all([
    one("select count(*)::bigint c from products_master"),
    one("select count(*)::bigint c from brands"),
    one("select count(*)::bigint c from categories"),
    one("select count(*)::bigint c from product_types"),
    one("select count(*)::bigint c from markets"),
    one("select count(*)::bigint c from product_price_facts"),
    one("select count(*)::bigint c from product_rating_facts"),
    one("select count(*)::bigint c from transform_observations where status='open'"),
    one("select count(*)::bigint c from ai_rule_suggestions where status='open'"),
    one("select count(*)::bigint c from staged_products where validation_status='needs_review'"),
  ]);
  const alertList = await alerts(pool);
  return {
    cards: {
      products,
      brands,
      categories,
      types,
      markets,
      priceFacts,
      ratingFacts,
      openObservations: openObs,
      openSuggestions: openSug,
      stagedNeedsReview: staged,
    },
    alertCounts: {
      critical: alertList.filter((a) => a.level === "critical").length,
      warning: alertList.filter((a) => a.level === "warning").length,
    },
    generatedAt: new Date().toISOString(),
  };
}
