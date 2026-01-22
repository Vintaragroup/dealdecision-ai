import type { VisionExtractorConfig } from "../visual-extraction";

type PdfV2ExtractRequest = {
	document_id: string;
	pdf_b64: string;
	extractor_version?: string;
	max_pages?: number;
};

type PdfV2ExtractResponse = {
	document_id: string;
	extractor_version: string;
	pages: unknown[];
};

export async function callPdfV2Worker(
	config: Pick<VisionExtractorConfig, "visionWorkerUrl" | "timeoutMs">,
	request: PdfV2ExtractRequest,
	fetchImplOrOptions:
		| typeof fetch
		| {
				fetchImpl?: typeof fetch;
				timeoutMs?: number;
		  }
		| undefined = fetch
): Promise<PdfV2ExtractResponse | null> {
	const options =
		typeof fetchImplOrOptions === "function"
			? { fetchImpl: fetchImplOrOptions, timeoutMs: undefined }
			: (fetchImplOrOptions ?? {});
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs =
		typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
			? options.timeoutMs
			: Math.max(15000, config.timeoutMs);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetchImpl(`${config.visionWorkerUrl}/extract-pdf-v2`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const json = (await res.json()) as PdfV2ExtractResponse;
		if (!json || typeof json !== "object") return null;
		if (!Array.isArray((json as any).pages)) return null;
		return json;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
