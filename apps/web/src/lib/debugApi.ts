export type DebugApiKind = 'api' | 'sse';

export type DebugApiEntry =
	| {
			kind: 'api';
			ts: number;
			method: string;
			path: string;
			dealId?: string;
			status: number;
			duration_ms: number;
			keys: string[];
			error?: string;
		}
	| {
			kind: 'sse';
			ts: number;
			event: string;
			dealId?: string;
			keys?: string[];
			dataPreview?: string;
			error?: string;
		};

const MAX_ENTRIES = 20;

function isDebugEnabled(): boolean {
	const metaEnv = (import.meta as any)?.env as any;
	return Boolean(metaEnv?.DEV) && String(metaEnv?.VITE_DEBUG_API ?? '') === '1';
}

const state = {
	enabled: isDebugEnabled(),
	entries: [] as DebugApiEntry[],
	listeners: new Set<() => void>(),
};

function nowMs(): number {
	return Date.now();
}

function safeTopLevelKeys(value: unknown): string[] {
	if (value == null) return [];
	if (Array.isArray(value)) return ['[array]'];
	if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).slice(0, 50);
	return [`[${typeof value}]`];
}

function safePreview(value: unknown, maxLen = 180): string {
	try {
		const str = typeof value === 'string' ? value : JSON.stringify(value);
		if (str.length <= maxLen) return str;
		return str.slice(0, maxLen) + '…';
	} catch {
		return String(value);
	}
}

function push(entry: DebugApiEntry) {
	if (!state.enabled) return;
	state.entries.unshift(entry);
	if (state.entries.length > MAX_ENTRIES) state.entries.length = MAX_ENTRIES;
	for (const l of state.listeners) l();
}

export function debugApiIsEnabled(): boolean {
	return state.enabled;
}

export function debugApiSubscribe(listener: () => void): () => void {
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}

export function debugApiGetEntries(): DebugApiEntry[] {
	return state.entries;
}

export function debugApiLogCall(params: {
	method: string;
	path: string;
	dealId?: string;
	status: number;
	duration_ms: number;
	response: unknown;
	error?: unknown;
}) {
	if (!state.enabled) return;
	const errorMessage = params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined;
	const keys = safeTopLevelKeys(params.response);

	push({
		kind: 'api',
		ts: nowMs(),
		method: params.method,
		path: params.path,
		dealId: params.dealId,
		status: params.status,
		duration_ms: Math.round(params.duration_ms),
		keys,
		error: errorMessage,
	});

	// Console log (dev-only, gated)
	const line = {
		type: 'ddai.api',
		method: params.method,
		path: params.path,
		dealId: params.dealId,
		status: params.status,
		duration_ms: Math.round(params.duration_ms),
		keys,
		error: errorMessage,
	};
	if (errorMessage) {
		console.warn('[DDAI]', line);
	} else {
		console.info('[DDAI]', line);
	}
}

export function debugApiLogSse(params: {
	event: string;
	dealId?: string;
	data?: unknown;
	error?: unknown;
}) {
	if (!state.enabled) return;
	const errorMessage = params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined;
	const keys = params.data !== undefined ? safeTopLevelKeys(params.data) : undefined;

	push({
		kind: 'sse',
		ts: nowMs(),
		event: params.event,
		dealId: params.dealId,
		keys,
		dataPreview: params.data !== undefined ? safePreview(params.data) : undefined,
		error: errorMessage,
	});

	const line = {
		type: 'ddai.sse',
		event: params.event,
		dealId: params.dealId,
		keys,
		error: errorMessage,
	};
	if (errorMessage) {
		console.warn('[DDAI]', line);
	} else {
		console.info('[DDAI]', line);
	}
}

export function debugApiInferDealId(params: { path: string; body?: unknown }): string | undefined {
	const pathMatch = params.path.match(/\/api\/v1\/deals\/([^/?#]+)/i);
	if (pathMatch?.[1]) return pathMatch[1];

	const body = params.body;
	if (typeof body === 'string') {
		try {
			const parsed = JSON.parse(body) as any;
			if (parsed && typeof parsed.deal_id === 'string') return parsed.deal_id;
		} catch {
			// ignore
		}
	}
	if (body && typeof body === 'object') {
		const anyBody = body as any;
		if (typeof anyBody.deal_id === 'string') return anyBody.deal_id;
	}

	return undefined;
}
