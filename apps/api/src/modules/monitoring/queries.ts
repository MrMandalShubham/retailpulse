/**
 * Monitoring queries for the clean DIP. Generic table/phase health is generated
 * from config (CORE_TABLES / PHASES — trusted constants, injection-safe). The
 * flow-specific bits cover discovery and the ingest-&-clean step.
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
      processed = 0;
    let lastRunStatus: string | null = null;
    let avgSeconds: number | null = null;

    if (p.runTable) {
      const agg = (
        await pool.query(
          `select count(*)::int as runs,
             count(*) filter (where ${q(p.statusColumn)}='succeeded')::int as ok,
             count(*) filter (where ${q(p.statusColumn)}='failed')::int as failed_runs,
             ${p.processedColumn ? `coalesce(sum(${q(p.processedColumn)}),0)::int` : "0"} as processed,
             avg(extract(epoch from (${q(p.finishedColumn)} - ${q(p.startedColumn)})))::float as avg_secs
           from ${q(p.runTable)}`,
        )
      ).rows[0];
      runs = n(agg?.runs);
      succeededRuns = n(agg?.ok);
      failedRuns = n(agg?.failed_runs);
      processed = n(agg?.processed);
      avgSeconds = agg?.avg_secs != null ? Math.round(n(agg.avg_secs) * 10) / 10 : null;
      const last = (
        await pool.query(
          `select ${q(p.statusColumn)} as s from ${q(p.runTable)} order by created_at desc limit 1`,
        )
      ).rows[0];
      lastRunStatus = (last?.s as string | null) ?? null;
      // crawl_jobs has no per-run processed counter — use the clean-store count.
      if (!p.processedColumn) processed = outputRows;
    } else {
      processed = outputRows; // no run table: fall back to output count
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
      outputRows,
      avgSeconds,
    });
  }
  return out;
}

/** Phase 0 (discovery) — per-source mapping, funnel, and recent runs. */
export async function discoveryStats(pool: Queryable) {
  const sourceRows = (
    await pool.query(
      `select s.name, s.slug, (s.discovery_config->>'strategy') as strategy,
              count(d.id)::int as total_mapped,
              count(d.id) filter (where d.batch_status='pending')::int as pending,
              count(d.id) filter (where d.batch_status='queued')::int as queued,
              count(d.id) filter (where d.batch_status='ingested')::int as ingested,
              count(d.id) filter (where d.batch_status='promoted')::int as promoted,
              max(d.created_at) as last_seen
       from sources s
       left join discovered_product_pages d on d.source_id = s.id
       where s.discovery_config is not null
       group by s.id, s.name, s.slug, s.discovery_config
       order by count(d.id) desc`,
    )
  ).rows;
  const sources = sourceRows.map((r) => ({
    name: r.name,
    slug: r.slug,
    strategy: (r.strategy as string | null) ?? null,
    totalMapped: n(r.total_mapped),
    pending: n(r.pending),
    queued: n(r.queued),
    ingested: n(r.ingested),
    promoted: n(r.promoted),
    lastSeen: (r.last_seen as string | null) ?? null,
  }));

  const recentRuns = (
    await pool.query(
      `select coalesce(s.slug, '—') as source, dr.strategy, dr.status,
              dr.urls_discovered, dr.new_urls, dr.updated_urls, dr.errors, dr.created_at
       from discovery_runs dr left join sources s on s.id = dr.source_id
       order by dr.created_at desc limit 12`,
    )
  ).rows;

  const t =
    (
      await pool.query(
        `select count(distinct source_id)::int as sources, count(*)::int as mapped,
                count(*) filter (where batch_status='ingested')::int as ingested,
                count(*) filter (where batch_status='pending')::int as pending
         from discovered_product_pages`,
      )
    ).rows[0] ?? {};

  return {
    totals: {
      sourcesInDiscovery: n(t.sources),
      totalMapped: n(t.mapped),
      ingested: n(t.ingested),
      pending: n(t.pending),
    },
    sources,
    recentRuns,
  };
}

/** Unified run timeline: discovery + ingestion. */
export async function runHistory(pool: Queryable, limit: number) {
  const rows = (
    await pool.query(
      `(select 'discovery' as phase, id::text, created_at, started_at, finished_at, status,
               urls_discovered as input, new_urls as processed, errors as failed, error_message as note
        from discovery_runs)
       union all
       (select 'ingestion', id::text, created_at, started_at, finished_at, status,
               null::int, null::int, null::int, error_message from crawl_jobs)
       order by created_at desc limit ${Math.min(limit, 200)}`,
    )
  ).rows;
  return rows;
}

/** Derived alert center — table null-rates + duplicate business keys. */
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

  const order = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return items;
}

export async function overview(pool: Queryable) {
  const one = async (sqlText: string) => n((await pool.query(sqlText)).rows[0]?.c);
  const [sources, discovered, pending, ingested, cleanProducts, snapshots] = await Promise.all([
    one("select count(*)::bigint c from sources"),
    one("select count(*)::bigint c from discovered_product_pages"),
    one("select count(*)::bigint c from discovered_product_pages where batch_status='pending'"),
    one("select count(*)::bigint c from discovered_product_pages where batch_status='ingested'"),
    one("select count(*)::bigint c from oliveyoung_global_products"),
    one("select count(*)::bigint c from oliveyoung_global_product_snapshots"),
  ]);
  const alertList = await alerts(pool);
  return {
    cards: { sources, discovered, pending, ingested, cleanProducts, snapshots },
    alertCounts: {
      critical: alertList.filter((a) => a.level === "critical").length,
      warning: alertList.filter((a) => a.level === "warning").length,
    },
    generatedAt: new Date().toISOString(),
  };
}
