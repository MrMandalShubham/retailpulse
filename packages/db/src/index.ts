export { createDb, type Db, type DbConnection } from "./client.js";
export * as schema from "./schema/index.js";

// Re-exported so consumers (API routes, worker repos) can build queries
// without depending on drizzle-orm directly.
export { sql, eq, and, desc, asc, inArray, count } from "drizzle-orm";
