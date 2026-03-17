import type { Job } from "bullmq";
import {
  updateDocumentStatus,
  updateDocumentAnalysis,
  updateDocumentVerification,
  getDocumentsForDealWithVerification,
  insertDocumentExtractionAudit,
} from "../../lib/db";
import { verifyDocumentExtraction } from "../../lib/verification";
import { remediateStructuredData } from "../../lib/remediation";
import type { DocumentAnalysis, ExtractedContent } from "../../lib/processors";
import { updateJob } from "../../lib/worker-utils";

export async function remediateExtractionProcessor(job: Job): Promise<unknown> {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const includeWarnings = Boolean((job.data as { include_warnings?: boolean } | undefined)?.include_warnings);

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Scanning documents needing remediation", 5);
		const documents = await getDocumentsForDealWithVerification(dealId);
		if (documents.length === 0) {
			await updateJob(job, "succeeded", "No documents found", 100);
			return { ok: true, remediated: 0 };
		}

		const candidates = documents.filter((d) => {
			if (d.status !== "completed" && d.status !== "ready_for_analysis") return false;
			if (d.verification_status === "failed") return true;
			if (includeWarnings && d.verification_status === "warnings") return true;
			// If never verified but has extracted content, allow remediation only when includeWarnings.
			if (includeWarnings && (d.verification_status == null)) return true;
			return false;
		});

		if (candidates.length === 0) {
			await updateJob(job, "succeeded", "No documents matched remediation criteria", 100);
			return { ok: true, remediated: 0 };
		}

		await updateJob(job, "running", `Remediating ${candidates.length} document(s)`, 10);

		let remediated = 0;
		let verifiedAfter = 0;
		let warningsAfter = 0;
		let failedAfter = 0;

		for (let i = 0; i < candidates.length; i++) {
			const doc = candidates[i];
			const progressPct = Math.round((i / candidates.length) * 80) + 10;

			await insertDocumentExtractionAudit({
				documentId: doc.id,
				dealId: doc.deal_id,
				structuredData: doc.structured_data ?? null,
				extractionMetadata: doc.extraction_metadata ?? null,
				fullContent: doc.full_content ?? null,
				fullText: doc.full_text ?? null,
				verificationStatus: doc.verification_status ?? null,
				verificationResult: doc.verification_result ?? null,
				reason: "remediate_extraction",
				triggeredByJobId: job.id?.toString(),
			});

			const structuredData = (doc.structured_data as Partial<DocumentAnalysis["structuredData"]> | null) ?? {
				keyMetrics: [],
				mainHeadings: [],
				textSummary: "",
				entities: [],
			};

			const remediation = remediateStructuredData({
				structuredData: {
					keyFinancialMetrics: structuredData.keyFinancialMetrics,
					keyMetrics: structuredData.keyMetrics ?? [],
					mainHeadings: structuredData.mainHeadings ?? [],
					textSummary: structuredData.textSummary ?? "",
					entities: structuredData.entities ?? [],
				},
				fullText: doc.full_text,
			});

			// Preserve raw fields; only update canonical structured_data + metadata.
			const prevMeta = (doc.extraction_metadata && typeof doc.extraction_metadata === "object")
				? (doc.extraction_metadata as Record<string, unknown>)
				: {};
			const history = Array.isArray((prevMeta as any).remediation_history)
				? ([...(prevMeta as any).remediation_history] as unknown[])
				: [];
			history.push({
				at: new Date().toISOString(),
				type: "canonicalize_structured_data",
				changes: remediation.changes,
			});

			const nextMeta = {
				...prevMeta,
				remediation_history: history,
			};

			await updateDocumentAnalysis({
				documentId: doc.id,
				structuredData: remediation.structuredData,
				extractionMetadata: nextMeta,
			});

			// Re-verify after remediation.
			const analysis: DocumentAnalysis = {
				documentId: doc.id,
				dealId: doc.deal_id,
				fileType: "unknown",
				fileName: doc.title,
				extractedAt: new Date(doc.updated_at || doc.uploaded_at).toISOString(),
				contentType: "unknown",
				content: (doc.full_content as ExtractedContent | null) ?? null,
				metadata: {
					fileSizeBytes: 0,
					processingTimeMs: 0,
					extractionSuccess: doc.status === "completed" || doc.status === "ready_for_analysis",
					errorMessage: undefined,
				},
				structuredData: remediation.structuredData,
			};

			const verificationResult = verifyDocumentExtraction({
				analysis,
				fullText: doc.full_text ?? undefined,
				pageCount: doc.page_count || 0,
				extractionMetadata: nextMeta,
			});

			const verificationStatus = verificationResult.overall_score >= 0.8
				? "verified"
				: verificationResult.overall_score >= 0.5
				? "warnings"
				: "failed";

			if (verificationStatus === "verified") verifiedAfter++;
			else if (verificationStatus === "warnings") warningsAfter++;
			else failedAfter++;

			await updateDocumentVerification({
				documentId: doc.id,
				verificationStatus,
				verificationResult,
				readyForAnalysisAt: verificationStatus === "verified" ? new Date() : undefined,
			});

			if (verificationStatus === "verified") {
				await updateDocumentStatus(doc.id, "ready_for_analysis");
			}

			remediated++;
			await updateJob(
				job,
				"running",
				`Remediated ${doc.title} → ${verificationStatus} (${(verificationResult.overall_score * 100).toFixed(0)}%)`,
				progressPct
			);
		}

		const message = `Remediation complete: ${remediated} processed (${verifiedAfter} verified, ${warningsAfter} warnings, ${failedAfter} failed)`;
		await updateJob(job, "succeeded", message, 100);
		return { ok: true, remediated, verifiedAfter, warningsAfter, failedAfter };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Remediation failed";
		await updateJob(job, "failed", message, 100);
		throw err;
	}
}
