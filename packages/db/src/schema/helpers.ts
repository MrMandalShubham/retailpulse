import { sql, type SQL } from "drizzle-orm";

/**
 * Builds the SQL for a text + CHECK constraint enforcing a closed vocabulary.
 * V1 uses text + CHECK instead of native Postgres enums (approved decision:
 * lower migration friction while the model iterates). The allowed values come
 * from @dip/domain constants so the DB and domain layer share one source of truth.
 */
export function inList(columnName: string, values: readonly string[]): SQL {
  const quoted = values.map((value) => `'${value}'`).join(", ");
  return sql.raw(`"${columnName}" IN (${quoted})`);
}
