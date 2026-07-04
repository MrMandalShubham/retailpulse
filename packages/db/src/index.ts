export { createDb, type Db, type DbConnection } from "./client.js";
export * as schema from "./schema/index.js";

// Re-exported so consumers can write raw fragments (e.g. health-check pings)
// without depending on drizzle-orm directly.
export { sql } from "drizzle-orm";
