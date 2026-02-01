import { describe, it, expect } from "vitest";
import { assertSchema } from "./schema-check";

describe("assertSchema", () => {
  it("throws with missing list when required columns are absent", async () => {
    const mockPool = {
      query: async () => ({ rows: [{ table_name: "jobs", column_name: "payload" }] }),
    };

    await expect(
      assertSchema({
        pool: mockPool as any,
        fingerprint: { db: "db", ip: "1.2.3.4", port: 5432 },
      })
    ).rejects.toMatchObject({
      message: "schema_check_failed",
      missing: expect.arrayContaining(["evidence.confidence", "documents.extraction_metadata"]),
    });
  });

  it("does not throw when all required columns are present", async () => {
    const mockPool = {
      query: async () => ({
        rows: [
          { table_name: "evidence", column_name: "confidence" },
          { table_name: "jobs", column_name: "payload" },
          { table_name: "documents", column_name: "extraction_metadata" },
        ],
      }),
    };

    await expect(
      assertSchema({
        pool: mockPool as any,
        fingerprint: { db: "db", ip: "1.2.3.4", port: 5432 },
      })
    ).resolves.toBeUndefined();
  });
});
