import { describe, it, expect } from 'vitest';
import {
	estimateFactOutputTokens,
	packFactsByTokenBudget,
	mergeFinancialVerifications,
} from '../financial-verifier-batching.js';
import type { FinancialFactV1 } from '@dealdecision/core';
import type { LLMFinancialVerificationV1 } from '@dealdecision/core/dist/models/llm-financial-verification-v1';

function makeFact(id: string, overrides: Partial<FinancialFactV1> = {}): FinancialFactV1 {
	return {
		fact_id: id,
		deal_id: 'deal-001',
		source_kind: 'deck',
		metric_key: 'revenue',
		period_type: 'unknown',
		period_label: 'current',
		value: 1,
		unit: 'currency',
		confidence: 'low',
		...overrides,
	} as FinancialFactV1;
}

function makeVerification(overrides: Partial<LLMFinancialVerificationV1> = {}): LLMFinancialVerificationV1 {
	return {
		schema_version: 'llm_financial_verification_v1',
		deal_id: 'deal-001',
		run_id: 'run-001',
		created_at: new Date().toISOString(),
		model: 'gpt-4o-mini',
		provider: 'openai',
		verified_values: [],
		financial_gaps: [],
		summary: null,
		xlsx_data_present: false,
		cap_table_present: false,
		...overrides,
	};
}

describe('estimateFactOutputTokens', () => {
	it('returns at least the structural floor for a fact with minimal text', () => {
		const fact = makeFact('a', { excerpt: undefined, source_pointer: undefined, metric_key: 'x', value: 1 });
		expect(estimateFactOutputTokens(fact)).toBeGreaterThanOrEqual(70);
	});

	it('grows with excerpt length', () => {
		const short = makeFact('a', { excerpt: 'short text' });
		const long = makeFact('b', { excerpt: 'a'.repeat(2000) });
		expect(estimateFactOutputTokens(long)).toBeGreaterThan(estimateFactOutputTokens(short));
	});
});

describe('packFactsByTokenBudget', () => {
	it('never drops a fact — every input fact appears in exactly one batch', () => {
		const facts = Array.from({ length: 143 }, (_, i) =>
			makeFact(`fact-${i}`, { excerpt: `some excerpt text for fact ${i}`.repeat(3) }),
		);
		const batches = packFactsByTokenBudget(facts);

		const allBatched = batches.flat();
		expect(allBatched).toHaveLength(143);
		expect(new Set(allBatched.map((f) => f.fact_id)).size).toBe(143);
	});

	it('keeps every batch at or under the token budget, this is the actual guarantee', () => {
		const facts = Array.from({ length: 50 }, (_, i) =>
			makeFact(`fact-${i}`, { excerpt: `excerpt content number ${i} `.repeat(10) }),
		);
		const budget = 1400;
		const batches = packFactsByTokenBudget(facts, budget);

		for (const batch of batches) {
			const total = batch.reduce((sum, f) => sum + estimateFactOutputTokens(f), 0);
			// A solo-fact batch may exceed budget if that one fact's own estimate
			// does (see next test) — but any batch with >1 fact must fit.
			if (batch.length > 1) {
				expect(total).toBeLessThanOrEqual(budget);
			}
		}
	});

	it('gives an oversized single fact its own batch rather than dropping it', () => {
		const huge = makeFact('huge', { excerpt: 'x'.repeat(20000) });
		const normal = makeFact('normal', { excerpt: 'short' });
		const batches = packFactsByTokenBudget([huge, normal], 1400);

		const allBatched = batches.flat();
		expect(allBatched.map((f) => f.fact_id).sort()).toEqual(['huge', 'normal']);
		const hugeBatch = batches.find((b) => b.some((f) => f.fact_id === 'huge'));
		expect(hugeBatch).toHaveLength(1);
	});

	it('does not spread facts across more batches than necessary for a small deal', () => {
		const facts = [makeFact('a', { excerpt: 'x' }), makeFact('b', { excerpt: 'y' }), makeFact('c', { excerpt: 'z' })];
		const batches = packFactsByTokenBudget(facts, 1400);
		expect(batches).toHaveLength(1);
	});

	it('returns an empty array for an empty facts array', () => {
		expect(packFactsByTokenBudget([], 1400)).toEqual([]);
	});

	it('throws for a non-positive token budget rather than producing an unbounded batch', () => {
		expect(() => packFactsByTokenBudget([makeFact('a')], 0)).toThrow();
		expect(() => packFactsByTokenBudget([makeFact('a')], -100)).toThrow();
	});

	it('produces the same batch membership for the same input (stable for cache keys)', () => {
		const facts = Array.from({ length: 30 }, (_, i) => makeFact(`fact-${i}`, { excerpt: `text ${i}`.repeat(5) }));
		const batchesA = packFactsByTokenBudget(facts, 1400);
		const batchesB = packFactsByTokenBudget(facts, 1400);
		expect(batchesA.map((b) => b.map((f) => f.fact_id))).toEqual(batchesB.map((b) => b.map((f) => f.fact_id)));
	});
});

describe('mergeFinancialVerifications', () => {
	it('concatenates verified_values across all successful batches', () => {
		const batch1 = makeVerification({ verified_values: [{ extraction_ref: 'a' } as any] });
		const batch2 = makeVerification({ verified_values: [{ extraction_ref: 'b' } as any, { extraction_ref: 'c' } as any] });

		const merged = mergeFinancialVerifications([batch1, batch2], { deal_id: 'deal-001', run_id: 'run-001' });

		expect(merged?.verified_values).toHaveLength(3);
	});

	it('excludes a failed batch (null) without treating it as verified-clean', () => {
		const batch1 = makeVerification({ verified_values: [{ extraction_ref: 'a' } as any] });

		const merged = mergeFinancialVerifications([batch1, null], { deal_id: 'deal-001', run_id: 'run-001' });

		// Only batch1's value is present — the failed batch contributes nothing,
		// it is not silently counted as "no issues found".
		expect(merged?.verified_values).toHaveLength(1);
	});

	it('returns null when every batch failed', () => {
		const merged = mergeFinancialVerifications([null, null], { deal_id: 'deal-001', run_id: 'run-001' });
		expect(merged).toBeNull();
	});

	it('ORs xlsx_data_present and cap_table_present across batches', () => {
		const batch1 = makeVerification({ xlsx_data_present: false, cap_table_present: false });
		const batch2 = makeVerification({ xlsx_data_present: true, cap_table_present: false });
		const batch3 = makeVerification({ xlsx_data_present: false, cap_table_present: true });

		const merged = mergeFinancialVerifications([batch1, batch2, batch3], { deal_id: 'deal-001', run_id: 'run-001' });

		expect(merged?.xlsx_data_present).toBe(true);
		expect(merged?.cap_table_present).toBe(true);
	});

	it('concatenates financial_gaps across batches', () => {
		const batch1 = makeVerification({ financial_gaps: [{ field: 'a' } as any] });
		const batch2 = makeVerification({ financial_gaps: [{ field: 'b' } as any] });

		const merged = mergeFinancialVerifications([batch1, batch2], { deal_id: 'deal-001', run_id: 'run-001' });

		expect(merged?.financial_gaps).toHaveLength(2);
	});
});
