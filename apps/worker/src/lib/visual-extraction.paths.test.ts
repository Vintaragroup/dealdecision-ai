import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Avoid touching real R2 signing in unit tests.
vi.mock("./r2", () => {
  return {
    getR2ObjectUrl: vi.fn(async ({ bucket, key }: any) => `https://r2.example/${bucket}/${encodeURIComponent(key)}`),
  };
});

describe("resolvePageImageUris path safety", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.UPLOAD_DIR = "/opt/render/project/src/apps/worker/uploads";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does not depend on /apps/api/uploads absolute paths from extraction_metadata", async () => {
    const { resolvePageImageUris } = await import("./visual-extraction.js");

    const apiPath = "/opt/render/project/src/apps/api/uploads/rendered_pages/doc_1";

    const pool = {
      query: async () => ({
        rows: [
          {
            page_count: 2,
            extraction_metadata: {
              rendered_pages_dir: apiPath,
            },
          },
        ],
      }),
    } as any;

    const statCalls: string[] = [];
    const fsImpl = {
      stat: async (p: string) => {
        statCalls.push(String(p));
        if (String(p).includes("/apps/api/uploads")) {
          throw new Error("should_not_stat_api_upload_dir");
        }
        throw new Error("ENOENT");
      },
      readdir: async () => [],
    } as any;

    const uris = await resolvePageImageUris(pool, "doc_1", { fsImpl, env: process.env, logger: { log() {}, warn() {}, error() {} } as any });

    expect(uris).toEqual([]);
    expect(statCalls.some((p) => p.includes("/apps/api/uploads"))).toBe(false);
  });

  it("prefers rendered_pages_r2 when present (no filesystem dependency)", async () => {
    const { resolvePageImageUris } = await import("./visual-extraction.js");

    const pool = {
      query: async () => ({
        rows: [
          {
            page_count: 15,
            extraction_metadata: {
				rendered_pages_r2: { bucket: "b", prefix: "deals/d/documents/x/rendered_pages", format: "page_%04d.png" },
            },
          },
        ],
      }),
    } as any;

    const fsImpl = {
      stat: async () => {
        throw new Error("ENOENT");
      },
      readdir: async () => [],
    } as any;

    const uris = await resolvePageImageUris(pool, "doc_r2", { fsImpl, env: process.env, logger: { log() {}, warn() {}, error() {} } as any });

    expect(uris.length).toBe(15);
    expect(uris[0].startsWith("https://r2.example/")).toBe(true);

  // Ensure we use rendered_pages_r2.prefix in the signed URL keys.
  for (const idx of [0, 10, 14]) {
    expect(decodeURIComponent(uris[idx])).toContain("/b/deals/d/documents/x/rendered_pages/");
    // And ensure we did NOT fall back to legacy /documents/<doc>/pages paths.
    expect(decodeURIComponent(uris[idx])).not.toContain("/documents/doc_r2/pages/");
  }
  });
});
