/**
 * Fixture builders for extract-visuals coordinator behavioral tests.
 *
 * Prefer these builders over inline payload blobs so test intent is clear
 * and payloads remain aligned when the coordinator's input shape evolves.
 */

import type { Job } from "bullmq";

// ── Job builders ──────────────────────────────────────────────────────────────

export function makeCoordinatorJob(overrides: Partial<Job["data"]> & { id?: string } = {}): Job {
	const { id = "job-coord-1", ...data } = overrides;
	return {
		id,
		data: {
			document_id: "doc-aaaa-0001",
			deal_id: "deal-aaaa-0001",
			...data,
		},
		updateProgress: async () => {},
	} as unknown as Job;
}

export function makeChunkJob(
	overrides: Partial<Job["data"]> & {
		id?: string;
		page_start?: number;
		page_end?: number;
	} = {}
): Job {
	const { id = "job-chunk-1", page_start = 0, page_end = 5, ...data } = overrides;
	return {
		id,
		data: {
			document_id: "doc-aaaa-0001",
			deal_id: "deal-aaaa-0001",
			chunk: { page_start, page_end },
			...data,
		},
		updateProgress: async () => {},
	} as unknown as Job;
}

// ── Document meta builders ────────────────────────────────────────────────────

export type MockDocMeta = {
	id: string;
	deal_id: string;
	title: string;
	type: string;
	mime_type: string;
	status: string;
	meta_status: string | null;
	page_count: number;
	extraction_metadata: Record<string, unknown>;
	structured_data: Record<string, unknown>;
	full_content: Record<string, unknown>;
	full_text: string;
	full_text_absent_reason: string | null;
	deleted_at: null;
};

export function makeReadyDocMeta(overrides: Partial<MockDocMeta> = {}): MockDocMeta {
	return {
		id: "doc-aaaa-0001",
		deal_id: "deal-aaaa-0001",
		title: "Test Deck",
		type: "powerpoint",
		mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		status: "ready_for_analysis",
		meta_status: "succeeded",
		page_count: 10,
		extraction_metadata: { status: "succeeded" },
		structured_data: {},
		full_content: {},
		full_text: "Revenue $1M ARR growing 2x YoY.",
		full_text_absent_reason: null,
		deleted_at: null,
		...overrides,
	};
}

export function makeBlockedDocMeta(overrides: Partial<MockDocMeta> = {}): MockDocMeta {
	return makeReadyDocMeta({
		status: "ingesting",
		meta_status: null,
		extraction_metadata: {},
		...overrides,
	});
}

// ── Pool mock builder ─────────────────────────────────────────────────────────

/**
 * Minimal pg.Pool mock. `queryImpl` is called for every pool.query().
 * Default implementation returns { rows: [] } for all queries.
 *
 * Pass a Map<string, any[]> keyed on SQL substrings to return fixture rows
 * for specific queries (matched by substring).
 */
export function makePoolMock(
	queryStubs: Map<string, { rows: unknown[] }> = new Map(),
	onQuery?: (sql: string, params?: unknown[]) => void
): {
	pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
	calls: Array<{ sql: string; params?: unknown[] }>;
} {
	const calls: Array<{ sql: string; params?: unknown[] }> = [];
	const pool = {
		query: async (sql: string, params?: unknown[]) => {
			calls.push({ sql, params });
			if (onQuery) onQuery(sql, params);
			// Match by substring of the SQL
			for (const [key, result] of queryStubs) {
				if (sql.includes(key)) return result;
			}
			return { rows: [] };
		},
	};
	return { pool, calls };
}

// ── Redis connection mock builder ─────────────────────────────────────────────

/**
 * Minimal IORedis mock for the finalize-lock path.
 * set() returns "OK" by default (lock acquired).
 */
export function makeConnectionMock(
	overrides: {
		setResult?: string | null;
		getResult?: string | null;
	} = {}
): { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } {
	const { setResult = "OK", getResult = null } = overrides;
	return {
		set: vi.fn().mockResolvedValue(setResult),
		get: vi.fn().mockResolvedValue(getResult),
		del: vi.fn().mockResolvedValue(1),
	};
}

// ── vi alias (so consumers don't need to import vitest separately) ────────────
// `vi` is a global in vitest test files but not in non-test modules; importing
// from vitest here lets the fixture builders reference it for fn() creation.
import { vi } from "vitest";
export { vi };
