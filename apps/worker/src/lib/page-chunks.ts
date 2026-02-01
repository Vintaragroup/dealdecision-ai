export type PageChunkRange = { start: number; end: number };

export function planPageChunks(params: { totalPages: number; chunkSize: number }): PageChunkRange[] {
	const totalPages = Number.isFinite(params.totalPages) ? Math.max(0, Math.floor(params.totalPages)) : 0;
	const chunkSize = Number.isFinite(params.chunkSize) ? Math.max(1, Math.floor(params.chunkSize)) : 10;
	if (totalPages === 0) return [];

	const ranges: PageChunkRange[] = [];
	for (let start = 0; start < totalPages; start += chunkSize) {
		ranges.push({ start, end: Math.min(totalPages, start + chunkSize) });
	}
	return ranges;
}

export function planChunkEnqueues(params: {
	totalPages: number;
	chunkSize: number;
}): { ranges: PageChunkRange[]; chunks_enqueued: number } {
	const ranges = planPageChunks({ totalPages: params.totalPages, chunkSize: params.chunkSize });
	return { ranges, chunks_enqueued: ranges.length };
}
