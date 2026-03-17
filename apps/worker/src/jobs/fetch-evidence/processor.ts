import type { Job } from "bullmq";
import {
  getPool,
  getDocumentsForDealWithAnalysis,
  deleteExtractionEvidenceForDeal,
  deleteExtractionEvidenceForDocument,
  insertEvidence,
  getEvidenceDocumentIds,
} from "../../lib/db";
import { deriveEvidenceDrafts } from "../../lib/evidence";
import { materializePhaseBVisualEvidenceForDeal } from "../../lib/phaseb/materialize-evidence";
import { updateJob } from "../../lib/worker-utils";

export async function fetchEvidenceProcessor(job: Job): Promise<unknown> {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const filter = (job.data as { filter?: string } | undefined)?.filter;
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for evidence fetch");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Fetching evidence", 5);
		// Also rebuild extraction evidence from stored structured_data so the UI shows
		// metric values/context (not just keys like numeric_value).
		const docsForAnalysis = await getDocumentsForDealWithAnalysis(dealId);
		if (docsForAnalysis.length === 0) {
			await updateJob(job, "succeeded", "No documents available for evidence");
			return { inserted: 0 };
		}

		// Important: wipe all existing extraction evidence for this deal before rebuilding.
		// This removes stale/orphaned rows (e.g. evidence tied to documents that were deleted)
		// and prevents legacy metrics like plain `numeric_value` from lingering.
		await deleteExtractionEvidenceForDeal({ dealId });

		let rebuilt = 0;
		for (const doc of docsForAnalysis) {
			const structured = (doc.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as any)
				: null;
			if (!structured) continue;

			// Defensive: deal-level delete above should already remove these, but keep the
			// per-document delete as a safeguard if this code is reused elsewhere.
			await deleteExtractionEvidenceForDocument({ documentId: doc.id });

			// Metrics
			const metrics = Array.isArray(structured?.keyMetrics) ? structured.keyMetrics : [];
			for (const metric of metrics) {
				const key = typeof metric?.key === "string" ? String(metric.key) : "metric";
				const rawValue = metric?.value;
				const value = typeof rawValue === "string"
					? rawValue
					: typeof rawValue === "number"
						? String(rawValue)
						: rawValue == null
							? ""
							: JSON.stringify(rawValue);
				const context = typeof metric?.source === "string" ? String(metric.source) : "";
				const isNumericValue = key.trim().toLowerCase() === "numeric_value";
				const label = isNumericValue ? "extracted_number" : key;
				const textParts = [`${label}${value ? `: ${value}` : ""}`];
				if (context) textParts.push(`source: ${context}`);
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "metric",
					text: textParts.join(" • "),
					confidence: 0.8,
				});
			}

			// Sections/headings
			const headings = Array.isArray(structured?.mainHeadings) ? structured.mainHeadings : [];
			for (const heading of headings) {
				if (typeof heading !== "string" || !heading.trim()) continue;
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "section",
					text: heading,
					confidence: 0.9,
				});
			}

			// Summary
			if (typeof structured?.textSummary === "string" && structured.textSummary.trim()) {
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "summary",
					text: structured.textSummary,
					confidence: 0.85,
				});
			}

			rebuilt += 1;
		}

		await updateJob(job, "running", `Rebuilt extraction evidence (docs=${rebuilt})`, 40);

		// Optionally materialize Phase B visual evidence into the canonical evidence table
		// so it appears on the Evidence tab (and becomes resolvable via /evidence/resolve).
		try {
			const phaseB = await materializePhaseBVisualEvidenceForDeal(getPool(), dealId);
			if (process.env.DDAI_DEBUG_PHASE_B === "1") {
				console.log(
					JSON.stringify({
						event: "phaseb_visual_evidence_materialized",
						deal_id: dealId,
						...phaseB,
					})
				);
			}
		} catch (err) {
			console.warn(
				JSON.stringify({
					event: "phaseb_visual_evidence_materialization_failed",
					deal_id: dealId,
					reason: err instanceof Error ? err.message : String(err),
				})
			);
		}

		const documents = docsForAnalysis.map((d) => ({
			document_id: d.id,
			deal_id: d.deal_id,
			title: d.title,
			type: d.type,
			status: d.status,
			uploaded_at: d.uploaded_at,
			updated_at: d.updated_at,
		}));

		const existingDocIds = await getEvidenceDocumentIds(dealId);
		const drafts = deriveEvidenceDrafts(documents, { filter, excludeDocumentIds: existingDocIds });
		let inserted = 0;

		for (const draft of drafts) {
			await insertEvidence({
				deal_id: dealId,
				document_id: draft.document_id,
				source: draft.source,
				kind: draft.kind,
				text: draft.text,
				confidence: 0.7,
			});
			inserted += 1;
		}

		const message = inserted === 0
			? `No new fetch_evidence items created (rebuilt extraction evidence for ${rebuilt} doc(s))`
			: `Created ${inserted} fetch_evidence item(s) (rebuilt extraction evidence for ${rebuilt} doc(s))`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[fetch_evidence] deal=${dealId} inserted=${inserted} rebuilt=${rebuilt} filter=${filter ?? ""}`);
		return { inserted };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to fetch evidence";
		await updateJob(job, "failed", message);
		throw err;
	}
}
