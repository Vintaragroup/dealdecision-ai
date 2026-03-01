/**
 * export_report_pdf — BullMQ job processor
 *
 * Payload: ReportExportJobPayload (from @dealdecision/contracts)
 *
 * Steps:
 *  1. Mark export row as "processing"
 *  2. Fetch latest investor_insight_reports render_package for deal
 *  3. Build OrchestratorReportV1 via buildOrchestratorReportV1
 *  4. Render print-optimized HTML via renderReportHtml
 *  5. Launch Playwright Chromium → PDF buffer
 *  6. Upload PDF to R2 under deals/:dealId/exports/:timestamp-:hash.pdf
 *  7. Mark export row "completed" with r2_key + download_url
 *
 * On any error: mark export row "failed" with error_message.
 */

import type { Job } from "bullmq";
import { createHash, randomUUID } from "crypto";
import { getPool } from "../../lib/db";
import { uploadToR2, getR2ObjectUrl } from "../../lib/r2";
import { buildOrchestratorReportV1 } from "@dealdecision/core";
import type { ReportExportJobPayload } from "@dealdecision/contracts";
import { renderReportHtml } from "./html-renderer";

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function markExportStatus(
	exportId: string,
	status: "processing" | "completed" | "failed",
	extra: { r2_key?: string; download_url?: string; error_message?: string } = {}
) {
	const pool = getPool();
	const sets: string[] = ["status = $2", "updated_at = now()"];
	const params: unknown[] = [exportId, status];
	let idx = 3;

	if (extra.r2_key !== undefined) {
		sets.push(`r2_key = $${idx++}`);
		params.push(extra.r2_key);
	}
	if (extra.download_url !== undefined) {
		sets.push(`download_url = $${idx++}`);
		params.push(extra.download_url);
	}
	if (extra.error_message !== undefined) {
		sets.push(`error_message = $${idx++}`);
		params.push(extra.error_message);
	}

	await pool.query(
		`UPDATE deal_report_exports SET ${sets.join(", ")} WHERE id = $1`,
		params
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Playwright lazy loader — allows tests to mock at module level
// ─────────────────────────────────────────────────────────────────────────────

let _chromium: any = null;

async function getChromium() {
	if (_chromium === null) {
		try {
			// dynamic import allows Vitest to intercept via vi.mock("playwright").
			// playwright is not installed in local dev (only in the production Docker image),
			// so TS cannot resolve types here — suppressed intentionally.
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			const pw = await import("playwright");
			_chromium = pw.chromium;
		} catch (err) {
			throw new Error(
				`Playwright is not installed in the worker. Run: pnpm --filter apps/worker add playwright\n${String(err)}`
			);
		}
	}
	return _chromium;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core processor
// ─────────────────────────────────────────────────────────────────────────────

export async function exportReportPdfProcessor(job: Job): Promise<void> {
	// Parse payload
	const raw = job.data as Partial<ReportExportJobPayload>;
	const dealId = typeof raw.deal_id === "string" ? raw.deal_id.trim() : null;
	const exportId = typeof raw.export_id === "string" ? raw.export_id.trim() : null;

	if (!dealId || !exportId) {
		throw new Error(`[export_report_pdf] Missing deal_id or export_id in job payload: ${JSON.stringify(raw)}`);
	}

	const config = raw.config ?? { preset: "investor", format: "standard", sections: [] };

	const logPrefix = `[export_report_pdf] job=${job.id} deal=${dealId} export=${exportId}`;
	console.info(`${logPrefix} start`);

	// ── 1. Mark processing ──────────────────────────────────────────────────
	try {
		await markExportStatus(exportId, "processing");
	} catch (err) {
		// Non-fatal: allow processing to continue; the row may not exist yet in tests.
		console.warn(`${logPrefix} failed to mark processing`, err);
	}

	try {
		// ── 2. Fetch render_package ────────────────────────────────────────────
		const pool = getPool();
		const { rows } = await pool.query<{
			render_package: unknown;
			deal_name: string | null;
		}>(
			`SELECT
        iir.render_package,
        d.name AS deal_name
       FROM investor_insight_reports iir
       LEFT JOIN deals d ON d.id = iir.deal_id
       WHERE iir.deal_id = $1
       ORDER BY iir.updated_at DESC
       LIMIT 1`,
			[dealId]
		);

		if (rows.length === 0 || !rows[0].render_package) {
			throw new Error(`No investor_insight_reports render_package found for deal ${dealId}`);
		}

		const rp = rows[0].render_package as any;
		if (!Array.isArray(rp?.sections)) {
			throw new Error(`render_package.sections is not an array for deal ${dealId}`);
		}

		const dealName = rows[0].deal_name ?? undefined;

		// ── 3. Build OrchestratorReportV1 ─────────────────────────────────────
		const report = buildOrchestratorReportV1({ dealId, renderPackage: rp });

		// ── 4. Render HTML ────────────────────────────────────────────────────
		const html = renderReportHtml({ report, config, dealName });

		// ── 5. Playwright PDF ────────────────────────────────────────────────
		const chromium = await getChromium();
		const browser = await chromium.launch({
			// headless must be explicit: Playwright ≥1.41 defaults to headless but
			// future versions or env flags (PLAYWRIGHT_CHROMIUM_HEADLESS=0) could
			// override. Set true unconditionally for deterministic container behavior.
			headless: true,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-gpu",
			],
		});

		let pdfBuffer: Buffer;
		try {
			const page = await browser.newPage();
			await page.setContent(html, { waitUntil: "networkidle" });

			const pdfRaw = await page.pdf({
				format: "Letter",
				printBackground: true,
				// margins are set exclusively via CSS @page in html-renderer to avoid
				// Playwright + Chromium stacking page.pdf(margin) on top of @page margin.
				...(config.includePageNumbers !== false
					? {
							displayHeaderFooter: true,
							footerTemplate:
								'<div style="font-size:10px;color:#9ca3af;width:100%;text-align:center;padding:0 18mm"><span class="pageNumber"></span> of <span class="totalPages"></span></div>',
							headerTemplate: "<span></span>",
					  }
					: {}),
			});

			pdfBuffer = Buffer.isBuffer(pdfRaw) ? pdfRaw : Buffer.from(pdfRaw);
		} finally {
			await browser.close();
		}

		// ── 6. Upload to R2 ───────────────────────────────────────────────────
		const timestamp = Date.now();
		const hash = createHash("sha256")
			.update(`${dealId}:${exportId}:${timestamp}`)
			.digest("hex")
			.slice(0, 12);
		const r2Key = `deals/${dealId}/exports/${timestamp}-${hash}.pdf`;

		const bucket = process.env.R2_BUCKET ?? undefined;

		await uploadToR2({
			bucket,
			key: r2Key,
			body: pdfBuffer,
			contentType: "application/pdf",
		});

		const downloadUrl = await getR2ObjectUrl({ bucket, key: r2Key });

		// ── 7. Mark completed ────────────────────────────────────────────────
		await markExportStatus(exportId, "completed", { r2_key: r2Key, download_url: downloadUrl });

		console.info(`${logPrefix} done r2_key=${r2Key} size=${pdfBuffer.length}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`${logPrefix} failed:`, message);

		try {
			await markExportStatus(exportId, "failed", { error_message: message.slice(0, 2000) });
		} catch (updateErr) {
			console.error(`${logPrefix} also failed to mark failure`, updateErr);
		}

		throw err;
	}
}
