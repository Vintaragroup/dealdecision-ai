import { describe, it, expect, beforeEach } from "vitest";

// db.ts throws on import if DATABASE_URL is missing.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/db";

describe("getDocumentsForDealWithVerification deleted_at compatibility", () => {
  beforeEach(async () => {
    const db = await import("../db.js");
    db.__resetDocumentsDeletedAtExistsCacheForTests();
  });

  it("omits deleted_at clause when column absent", async () => {
    const db = await import("../db.js");

    const mockPool = {
      queries: [] as Array<{ sql: string; params?: unknown[] }>,
      query: async (sql: string, params?: unknown[]) => {
        mockPool.queries.push({ sql, params });

			// Schema check returns no rows => deleted_at absent.
			if (/information_schema\.columns/i.test(sql)) {
				return { rows: [] };
			}

			return { rows: [] };
      },
    };

    await db.__getDocumentsForDealWithVerificationWithPoolForTests(mockPool as any, "deal-1");

		// First query is schema check, second is the docs query.
    expect(mockPool.queries.length).toBe(2);
    expect(mockPool.queries[1].sql).not.toMatch(/deleted_at/i);
  });

  it("includes deleted_at clause when column present", async () => {
    const db = await import("../db.js");

    const mockPool = {
      queries: [] as Array<{ sql: string; params?: unknown[] }>,
      query: async (sql: string, params?: unknown[]) => {
        mockPool.queries.push({ sql, params });

			// Schema check returns a row => deleted_at exists.
			if (/information_schema\.columns/i.test(sql)) {
				return { rows: [{ ok: 1 }] };
			}

			return { rows: [] };
      },
    };

    await db.__getDocumentsForDealWithVerificationWithPoolForTests(mockPool as any, "deal-1");

		// First query is schema check, second is the docs query.
    expect(mockPool.queries.length).toBe(2);
    expect(mockPool.queries[1].sql).toMatch(/deleted_at/i);
    expect(mockPool.queries[1].sql).toMatch(/deleted_at\s+IS\s+NULL/i);
  });
});
