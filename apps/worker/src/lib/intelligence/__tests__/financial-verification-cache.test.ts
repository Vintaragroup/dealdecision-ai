import { describe, it, expect } from 'vitest';
import { computeFinancialFactsFingerprint } from '../financial-verification-cache.js';
import type { FinancialFactV1 } from '@dealdecision/core';

function makeFact(overrides: Partial<FinancialFactV1> = {}): FinancialFactV1 {
	return {
		fact_id: 'factv1:deal-001:revenue:unknown:current:abc123',
		deal_id: 'deal-001',
		source_kind: 'deck',
		metric_key: 'revenue',
		period_type: 'unknown',
		period_label: 'current',
		value: 2_000_000_000,
		unit: 'currency',
		confidence: 'low',
		...overrides,
	} as FinancialFactV1;
}

describe('computeFinancialFactsFingerprint', () => {
	it('is stable for the same facts across calls', () => {
		const facts = [makeFact()];
		expect(computeFinancialFactsFingerprint(facts)).toBe(computeFinancialFactsFingerprint(facts));
	});

	it('is stable regardless of array order', () => {
		const a = makeFact({ fact_id: 'factv1:deal-001:revenue:unknown:current:aaa' });
		const b = makeFact({ fact_id: 'factv1:deal-001:raise_amount:unknown:current:bbb', metric_key: 'raise_amount' });

		expect(computeFinancialFactsFingerprint([a, b])).toBe(computeFinancialFactsFingerprint([b, a]));
	});

	it('changes when a fact value changes', () => {
		const before = [makeFact({ value: 2_000_000_000 })];
		const after = [makeFact({ value: 3_000_000_000 })];
		expect(computeFinancialFactsFingerprint(before)).not.toBe(computeFinancialFactsFingerprint(after));
	});

	it('changes when a fact metric_key changes (e.g. after a correction was applied)', () => {
		const before = [makeFact({ metric_key: 'revenue' })];
		const after = [makeFact({ metric_key: 'modeled_economics' })];
		expect(computeFinancialFactsFingerprint(before)).not.toBe(computeFinancialFactsFingerprint(after));
	});

	it('changes when a fact is added', () => {
		const before = [makeFact()];
		const after = [makeFact(), makeFact({ fact_id: 'factv1:deal-001:raise_amount:unknown:current:def', metric_key: 'raise_amount' })];
		expect(computeFinancialFactsFingerprint(before)).not.toBe(computeFinancialFactsFingerprint(after));
	});

	it('returns a consistent fingerprint for an empty facts array', () => {
		expect(computeFinancialFactsFingerprint([])).toBe(computeFinancialFactsFingerprint([]));
	});
});
