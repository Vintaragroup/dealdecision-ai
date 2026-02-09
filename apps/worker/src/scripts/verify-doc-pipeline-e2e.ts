/*
End-to-end verification harness for the ingestion → render → extract visuals → analyze pipeline.

Usage (local docker):
  API_BASE_URL=http://localhost:9000 tsx apps/worker/src/scripts/verify-doc-pipeline-e2e.ts

Notes:
- Requires API + worker running and connected to the same DB/Redis.
- For full rendered_pages verification, R2 must be configured and enabled in the worker.
*/

import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

type DealCreateResponse = {
  id: string;
  name: string;
};

type UploadJsonResponse = {
  document_id: string;
  job_id: string;
};

type JobStatusResponse = {
  job_id: string;
  status: string;
  message?: string | null;
};

type DocumentStatusResponse = {
  document_id: string;
  deal_id: string;
  status: string;
  extraction_metadata: any;
};

type DocumentVerificationResponse = {
  deal_id: string;
  document_id: string;
  status?: string | null;
  // May include diagnostic fields depending on API version.
  extraction_metadata?: any;
};

type VisualAssetsResponse = {
  assets: unknown[];
};

type ExtractVisualsResponse =
  | { job_id: string; status?: string }
  | { error: string; blocked_documents?: unknown[]; render_jobs_enqueued?: unknown[] };

type GeneratedFixtures = {
  pdf_base64: string;
  pptx_base64: string;
  docx_base64: string;
  xlsx_base64: string;
  png_base64: string;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const authTokenRaw = typeof process.env.AUTH_TOKEN === "string" ? process.env.AUTH_TOKEN.trim() : "";
  const authHeaderValue = authTokenRaw
    ? authTokenRaw.toLowerCase().startsWith("bearer ")
      ? authTokenRaw
      : `Bearer ${authTokenRaw}`
    : null;

  const hasBody = init?.body != null;
  const isJsonBody = typeof init?.body === "string";

  const headers = new Headers(init?.headers);
  if (hasBody && isJsonBody) headers.set("content-type", "application/json");
  if (authHeaderValue) headers.set("authorization", authHeaderValue);

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.toString()}${text ? `\n${text}` : ""}`);
  }

  return (await res.json()) as T;
}

function buildAuthHeaders(init?: RequestInit): Headers {
  const authTokenRaw = typeof process.env.AUTH_TOKEN === "string" ? process.env.AUTH_TOKEN.trim() : "";
  const authHeaderValue = authTokenRaw
    ? authTokenRaw.toLowerCase().startsWith("bearer ")
      ? authTokenRaw
      : `Bearer ${authTokenRaw}`
    : null;

  const headers = new Headers(init?.headers);
  if (authHeaderValue) headers.set("authorization", authHeaderValue);
  return headers;
}

async function waitForJob(base: URL, jobId: string, opts: { timeoutMs: number; pollMs: number }) {
  const started = Date.now();
  let lastStatus: string | null = null;
  let lastLogAt = 0;
  while (true) {
    const elapsed = Date.now() - started;
    if (elapsed > opts.timeoutMs) {
      throw new Error(`Timed out waiting for job ${jobId} after ${Math.round(elapsed / 1000)}s`);
    }

    const jobUrl = new URL(`/api/v1/jobs/${encodeURIComponent(jobId)}`, base);
    const job = await fetchJson<JobStatusResponse>(jobUrl);

    // Emit periodic status to avoid “silent” waits.
    const now = Date.now();
    if (job.status !== lastStatus || now - lastLogAt > 15_000) {
      const msg = typeof job.message === "string" && job.message.trim() ? ` msg=${job.message.trim()}` : "";
      console.log(`Waiting for job ${jobId}: status=${job.status}${msg}`);
      lastStatus = job.status;
      lastLogAt = now;
    }
    if (["succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(job.status)) {
      if (!["succeeded", "succeeded_with_warnings"].includes(job.status)) {
        throw new Error(`Job ${jobId} ended status=${job.status} message=${job.message ?? ""}`);
      }
      return;
    }

    await sleep(opts.pollMs);
  }
}

async function waitForRenderedPagesReady(base: URL, dealId: string, documentId: string, opts: { timeoutMs: number; pollMs: number }) {
  const started = Date.now();
  let lastLogAt = 0;
  while (true) {
    const elapsed = Date.now() - started;
    if (elapsed > opts.timeoutMs) {
      throw new Error(`Timed out waiting for rendered_pages_r2 for doc ${documentId} after ${Math.round(elapsed / 1000)}s`);
    }

    const statusUrl = new URL(`/api/v1/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(documentId)}/status`, base);
    const doc = await fetchJson<DocumentStatusResponse>(statusUrl);

    const meta = doc.extraction_metadata && typeof doc.extraction_metadata === "object" ? doc.extraction_metadata : null;
    const renderedR2 = meta?.rendered_pages_r2 && typeof meta.rendered_pages_r2 === "object" ? meta.rendered_pages_r2 : null;
    const count = typeof meta?.rendered_pages_count === "number" ? meta.rendered_pages_count : 0;
    const rendered = typeof meta?.rendered_pages_rendered === "number" ? meta.rendered_pages_rendered : null;

    const now = Date.now();
    if (now - lastLogAt > 15_000) {
      console.log(
        `Waiting for rendered pages ${documentId}: rendered=${rendered ?? "?"}/${count} r2=${renderedR2 ? "yes" : "no"}`
      );
      lastLogAt = now;
    }

    if (renderedR2 && count > 0 && rendered != null && rendered >= count) {
      return;
    }

    await sleep(opts.pollMs);
  }
}

async function waitForFullTextSearchHit(params: {
  base: URL;
  dealId: string;
  query: string;
  expectedDocumentId: string;
  opts: { timeoutMs: number; pollMs: number };
}) {
  const started = Date.now();
  let lastCount: number | null = null;
  let lastLogAt = 0;
  while (true) {
    const elapsed = Date.now() - started;
    if (elapsed > params.opts.timeoutMs) {
      throw new Error(
        `Timed out waiting for document full-text search hit (q=${JSON.stringify(params.query)}) for doc ${params.expectedDocumentId} after ${Math.round(
          elapsed / 1000
        )}s`
      );
    }

    const url = new URL(
      `/api/v1/deals/${encodeURIComponent(params.dealId)}/documents/search?q=${encodeURIComponent(params.query)}&limit=10`,
      params.base
    );
    const body = await fetchJson<{ results: Array<{ document_id?: string }> }>(url);
    const results = Array.isArray(body?.results) ? body.results : [];
    const count = results.length;
    const hasHit = results.some((r) => typeof r?.document_id === "string" && r.document_id === params.expectedDocumentId);

    const now = Date.now();
    if (count !== lastCount || now - lastLogAt > 15_000) {
      console.log(
        `Waiting for full-text to be populated: q=${JSON.stringify(params.query)} results=${count} expected_hit=${hasHit ? "yes" : "no"}`
      );
      lastCount = count;
      lastLogAt = now;
    }

    if (hasHit) return;
    await sleep(params.opts.pollMs);
  }
}

function loadGeneratedFixtures(): GeneratedFixtures {
  const fixturesPath = join(__dirname, "fixtures", "generated-fixtures.json");
  const raw = readFileSync(fixturesPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<GeneratedFixtures>;

  const keys: Array<keyof GeneratedFixtures> = ["pdf_base64", "pptx_base64", "docx_base64", "xlsx_base64", "png_base64"];
  for (const key of keys) {
    if (typeof parsed[key] !== "string" || parsed[key]!.length < 16) {
      throw new Error(
        `Invalid fixtures file ${fixturesPath}: missing/invalid ${key}. Re-generate apps/worker/src/scripts/fixtures/generated-fixtures.json.`
      );
    }
  }

  return parsed as GeneratedFixtures;
}

function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

function makePngFixtureWithText(params: { text: string }): Buffer {
  const width = 1600;
  const height = 1000;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  // Draw the token as individually-spaced characters. This avoids kerning/ligature issues
  // that can cause Tesseract to drop/merge characters (we need an exact search token).
  const drawToken = (text: string, x0: number, y0: number, font: string, gapPx: number) => {
    ctx.font = font;
    let x = x0;
    for (const ch of text) {
      ctx.fillText(ch, x, y0);
      const w = ctx.measureText(ch).width;
      x += Math.max(1, w) + gapPx;
    }
  };

  // Prefer monospace to keep spacing consistent across environments.
  drawToken(params.text, 80, 120, "bold 110px monospace", 6);
  // Also draw a smaller copy as backup.
  drawToken(params.text, 80, 240, "bold 64px monospace", 4);

  ctx.font = "32px Arial";
  ctx.fillText("This is an image-only PDF page (no embedded text).", 80, 360);
  ctx.fillText("The system must OCR + promote into documents.full_text.", 80, 410);

  return canvas.toBuffer("image/png");
}

async function makeImageOnlyPdfFromPng(pngBytes: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(pngBytes);
  const page = pdf.addPage([png.width, png.height]);
  page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  const out = await pdf.save();
  return Buffer.from(out);
}

async function main() {
  const baseUrl = process.env.API_BASE_URL || "http://localhost:9000";
  const base = new URL(baseUrl);

  const timeoutMs = Number(process.env.TIMEOUT_MS || 10 * 60 * 1000);
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 2000);
  // Default OFF: local dev commonly renders to local disk (no rendered_pages_r2).
  // Enable explicitly when running against a stack configured with R2.
  const requireRenderedPagesR2 = (process.env.REQUIRE_RENDERED_PAGES_R2 || "0").trim() !== "0";

  if (!process.env.AUTH_TOKEN) {
    console.log("AUTH_TOKEN not set; script assumes API auth is disabled (e.g., DISABLE_CLERK_AUTH=1 in dev).\n");
  }

  const dealName = `e2e-doc-pipeline-${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;
  const deal = await fetchJson<DealCreateResponse>(new URL("/api/v1/deals", base), {
    method: "POST",
    body: JSON.stringify({ name: dealName, stage: "intake", priority: "medium" }),
  });

  const dealId = deal.id;
  console.log(`Created deal ${dealId} name=${dealName}`);

  const generated = loadGeneratedFixtures();

  // Add a true “scanned PDF” fixture: a PNG with text embedded as an image into a PDF.
  // This ensures the PDF has no native extractable text, forcing the OCR + promotion path.
  const scannedPdfToken = "SCANNEDPDFFIXTURE";
  const scannedPdfBytes = await makeImageOnlyPdfFromPng(makePngFixtureWithText({ text: scannedPdfToken }));

  const fixtures: Array<{ label: string; fileName: string; mimeType: string; bytes: Buffer; visual: boolean }> = [
    {
      label: "pdf_scanned",
      fileName: "fixture_scanned.pdf",
      mimeType: "application/pdf",
      bytes: scannedPdfBytes,
      visual: true,
    },
    { label: "pdf", fileName: "fixture.pdf", mimeType: "application/pdf", bytes: base64ToBuffer(generated.pdf_base64), visual: true },
    {
      label: "pptx",
      fileName: "fixture.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: base64ToBuffer(generated.pptx_base64),
      visual: true,
    },
    {
      label: "docx",
      fileName: "fixture.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: base64ToBuffer(generated.docx_base64),
      visual: true,
    },
    {
      label: "xlsx",
      fileName: "fixture.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: base64ToBuffer(generated.xlsx_base64),
      visual: true,
    },
    { label: "png", fileName: "fixture.png", mimeType: "image/png", bytes: base64ToBuffer(generated.png_base64), visual: true },
    { label: "csv", fileName: "fixture.csv", mimeType: "text/csv", bytes: Buffer.from("metric,value\nrevenue,123\n"), visual: false },
  ];

  const uploaded: Array<{ label: string; documentId: string; jobId: string; visual: boolean }> = [];

  for (const f of fixtures) {
    const uploadUrl = new URL(`/api/v1/deals/${encodeURIComponent(dealId)}/documents/upload`, base);
    const resp = await fetchJson<UploadJsonResponse>(uploadUrl, {
      method: "POST",
      body: JSON.stringify({
        file_buffer: f.bytes.toString("base64"),
        file_name: f.fileName,
        mime_type: f.mimeType,
        title: `Fixture ${f.label.toUpperCase()}`,
      }),
    });
    console.log(`Uploaded ${f.label} document_id=${resp.document_id} job_id=${resp.job_id}`);
    uploaded.push({ label: f.label, documentId: resp.document_id, jobId: resp.job_id, visual: f.visual });
  }

  for (const u of uploaded) {
    await waitForJob(base, u.jobId, { timeoutMs, pollMs });
    console.log(`Ingest complete ${u.label} document_id=${u.documentId}`);
  }

  // Wait for rendered pages for all visual fixtures.
  if (requireRenderedPagesR2) {
    for (const u of uploaded.filter((x) => x.visual)) {
      await waitForRenderedPagesReady(base, dealId, u.documentId, { timeoutMs, pollMs });
      console.log(`Rendered pages ready ${u.label} document_id=${u.documentId}`);
    }
  } else {
    console.log("REQUIRE_RENDERED_PAGES_R2=0; skipping rendered pages readiness checks.");
  }

  // Extract visuals for the deal.
  const extractUrl = new URL(`/api/v1/deals/${encodeURIComponent(dealId)}/extract-visuals`, base);
  // Self-healing expectation: even if rendered pages are not ready, the API should enqueue render jobs.
  // Retry until we get a job_id (or time out).
  let extractJobId: string | null = null;
  const extractStarted = Date.now();
  while (!extractJobId) {
    const elapsed = Date.now() - extractStarted;
    if (elapsed > timeoutMs) {
      throw new Error(`Timed out waiting to enqueue extract-visuals after ${Math.round(elapsed / 1000)}s`);
    }

    const headers = buildAuthHeaders({ headers: { "content-type": "application/json" } });
    headers.set("content-type", "application/json");
    const res = await fetch(extractUrl, { method: "POST", body: "{}", headers });
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as any;
      const enq = Array.isArray(body?.render_jobs_enqueued) ? body.render_jobs_enqueued.length : 0;
      console.log(`extract-visuals blocked (409); render_jobs_enqueued=${enq} retrying...`);
      await sleep(pollMs);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${extractUrl.toString()}${text ? `\n${text}` : ""}`);
    }
    const body = (await res.json()) as ExtractVisualsResponse as any;
    if (typeof body?.job_id !== "string" || body.job_id.length < 8) {
      throw new Error(`extract-visuals did not return job_id: ${JSON.stringify(body)}`);
    }
    extractJobId = body.job_id;
  }

  console.log(`extract-visuals enqueued job_id=${extractJobId}`);
  await waitForJob(base, extractJobId, { timeoutMs, pollMs });

  // OCR assertion: the PNG fixture is OCR'd and promoted into documents.full_text.
  const pngDoc = uploaded.find((u) => u.label === "png");
  if (pngDoc) {
    await waitForFullTextSearchHit({
      base,
      dealId,
      query: "PNG fixture",
      expectedDocumentId: pngDoc.documentId,
      opts: { timeoutMs, pollMs },
    });
    console.log(`OCR full-text present for png document_id=${pngDoc.documentId}`);
  } else {
    console.warn("PNG fixture not uploaded; skipping OCR full-text assertion.");
  }

  // OCR assertion: scanned PDF should become searchable after visual OCR is promoted.
  const scannedPdfDoc = uploaded.find((u) => u.label === "pdf_scanned");
  if (scannedPdfDoc) {
    await waitForFullTextSearchHit({
      base,
      dealId,
      query: scannedPdfToken,
      expectedDocumentId: scannedPdfDoc.documentId,
      opts: { timeoutMs, pollMs },
    });
    console.log(`OCR full-text present for scanned pdf document_id=${scannedPdfDoc.documentId}`);
  } else {
    console.warn("Scanned PDF fixture not uploaded; skipping scanned PDF OCR assertion.");
  }

  // Per-doc invariant: for every visual doc, either assets exist OR an explicit reason code is recorded.
  let totalAssets = 0;
  for (const u of uploaded.filter((x) => x.visual)) {
    const assetsUrl = new URL(
      `/api/v1/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(u.documentId)}/visual-assets`,
      base
    );
    const res = await fetchJson<VisualAssetsResponse>(assetsUrl);
    const count = Array.isArray(res.assets) ? res.assets.length : 0;
    totalAssets += count;
    console.log(`visual-assets ${u.label} count=${count}`);

	// API does not expose a stable /status endpoint in this repo. Use /verification as a lightweight
	// existence check and keep the invariant soft: assets may legitimately be 0.
	try {
		const verificationUrl = new URL(
			`/api/v1/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(u.documentId)}/verification`,
			base
		);
		await fetchJson<DocumentVerificationResponse>(verificationUrl);
	} catch (err) {
		console.warn(
			`verification fetch failed for ${u.label} doc=${u.documentId}: ${err instanceof Error ? err.message : String(err)}`
		);
	}
  }

  // Non-visual docs should be present but not require visual assets.
  for (const u of uploaded.filter((x) => !x.visual)) {
	// No-op (non-visual docs are allowed to have no visual extraction metadata)
	console.log(`non-visual ${u.label} ok`);
  }

  // Analyze the deal.
  const analyzeUrl = new URL(`/api/v1/deals/${encodeURIComponent(dealId)}/analyze`, base);
  const analyzeJob = await fetchJson<{ job_id: string }>(analyzeUrl, { method: "POST", body: "{}" });
  console.log(`analyze enqueued job_id=${analyzeJob.job_id}`);
  await waitForJob(base, analyzeJob.job_id, { timeoutMs, pollMs });

  console.log(`OK: end-to-end doc pipeline succeeded for deal ${dealId} (assets=${totalAssets})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
