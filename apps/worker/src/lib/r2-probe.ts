export type FetchLike = (input: string, init?: { method?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export async function probeHttpStatus(
	uri: string,
	opts?: {
		timeoutMs?: number;
		method?: "HEAD" | "GET";
		fetchImpl?: FetchLike;
	}
): Promise<{ ok: boolean; status: number | null; timed_out: boolean }> {
	const timeoutMs = typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
		? Math.max(500, Math.floor(opts.timeoutMs))
		: 7000;
	const method = opts?.method ?? "HEAD";
	const fetchImpl: FetchLike = opts?.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

	if (typeof uri !== "string" || !uri.trim()) return { ok: false, status: null, timed_out: false };
	if (typeof fetchImpl !== "function") return { ok: false, status: null, timed_out: false };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchImpl(uri, { method, signal: controller.signal });
		return { ok: Boolean(res?.ok), status: typeof res?.status === "number" ? res.status : null, timed_out: false };
	} catch {
		return { ok: false, status: null, timed_out: true };
	} finally {
		clearTimeout(timer);
	}
}

export function computeChunkRangeForPage(params: {
	pageIndex: number;
	totalPages: number;
	chunkSize: number;
}): { start: number; end: number } {
	const totalPages =
		typeof params.totalPages === "number" && Number.isFinite(params.totalPages)
			? Math.max(0, Math.floor(params.totalPages))
			: 0;
	const chunkSize =
		typeof params.chunkSize === "number" && Number.isFinite(params.chunkSize)
			? Math.max(1, Math.floor(params.chunkSize))
			: 1;
	const pageIndex =
		typeof params.pageIndex === "number" && Number.isFinite(params.pageIndex)
			? Math.max(0, Math.floor(params.pageIndex))
			: 0;

	if (totalPages === 0) return { start: 0, end: chunkSize };

	const start = Math.min(totalPages - 1, pageIndex);
	const chunkStart = Math.floor(start / chunkSize) * chunkSize;
	const chunkEnd = Math.min(totalPages, chunkStart + chunkSize);
	return { start: chunkStart, end: chunkEnd };
}
