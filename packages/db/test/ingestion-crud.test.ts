/**
 * Integration test for the ingestion-control tables. Requires a migrated
 * Postgres — set TEST_DATABASE_URL (e.g. the docker-compose database) to
 * enable; skipped otherwise so bare CI stays green.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DbConnection } from "../src/client.js";
import { crawlJobs, sources } from "../src/schema/ingestion.js";

const testDbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDbUrl)("ingestion-control tables (integration)", () => {
  let conn: DbConnection;
  const slug = `test-source-${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    conn = createDb(testDbUrl as string);
  });

  afterAll(async () => {
    // Cleanup is idempotent; cascade removes jobs.
    await conn.db.delete(sources).where(eq(sources.slug, slug));
    await conn.pool.end();
  });

  it("supports insert/select and cascades deletes from source to crawl jobs", async () => {
    const { db } = conn;

    const [source] = await db
      .insert(sources)
      .values({
        name: "Test Source",
        slug,
        baseUrl: "https://example.test/",
        sourceType: "website",
        seedUrls: ["https://example.test/a"],
      })
      .returning();
    expect(source).toBeDefined();
    expect(source?.enabled).toBe(true);

    const [job] = await db.insert(crawlJobs).values({ sourceId: source!.id }).returning();
    expect(job?.status).toBe("pending");
    expect(job?.attemptNumber).toBe(1);

    // Status vocabulary is enforced by CHECK.
    await expect(
      db.insert(crawlJobs).values({ sourceId: source!.id, status: "bogus" }),
    ).rejects.toThrow();

    // Deleting the source cascades through its crawl jobs.
    await db.delete(sources).where(eq(sources.id, source!.id));
    const orphanJobs = await db.select().from(crawlJobs).where(eq(crawlJobs.id, job!.id));
    expect(orphanJobs).toHaveLength(0);
  });
});
