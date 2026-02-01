import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock child_process BEFORE importing the module under test.
vi.mock("child_process", () => {
  return {
    execFile: (_cmd: string, _args: string[], _opts: any, cb: (err: any, stdout?: any, stderr?: any) => void) => {
      const err: any = new Error("spawn soffice ENOENT");
      err.code = "ENOENT";
      cb(err);
    },
  };
});

describe("renderNonPdfToPageImages", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns reason=soffice_missing for xlsx when LibreOffice is not installed", async () => {
    const { renderNonPdfToPageImages, getVisualPageImagePersistConfig } = await import("../rendered-pages.js");

    const cfg = { ...getVisualPageImagePersistConfig({ ENABLE_VISUAL_EXTRACTION: "1", VISUAL_PAGE_IMAGE_PERSIST: "1" } as any), enabled: true, persist: true };

    const res = await renderNonPdfToPageImages({
      buffer: Buffer.from("fake-xlsx"),
      fileExt: "xlsx",
      documentId: "doc_xlsx",
      uploadDir: "/tmp/uploads",
      pageCount: 0,
      config: cfg,
      logger: { log() {}, warn() {}, error() {} },
    });

    expect(res.ok).toBe(true);
    expect(res.reason).toBe("soffice_missing");
  });
});
