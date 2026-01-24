export type MemoryUsageSnapshot = {
	rss: number;
	heapUsed: number;
	external: number;
	arrayBuffers?: number;
};

function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function getMemoryUsageSnapshot(): MemoryUsageSnapshot {
	const m = process.memoryUsage();
	return {
		rss: m.rss,
		heapUsed: m.heapUsed,
		external: m.external,
		arrayBuffers: (m as any).arrayBuffers,
	};
}

export function logMemory(stage: string, meta?: Record<string, unknown>) {
	const snap = getMemoryUsageSnapshot();
	const payload = {
		event: "mem",
		stage,
		rss_mb: bytesToMb(snap.rss),
		heap_used_mb: bytesToMb(snap.heapUsed),
		external_mb: bytesToMb(snap.external),
		array_buffers_mb: snap.arrayBuffers == null ? null : bytesToMb(snap.arrayBuffers),
		pid: process.pid,
		...(meta ? { meta } : {}),
	};
	console.log(JSON.stringify(payload));
}

export async function yieldToEventLoop(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
