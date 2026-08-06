/**
 * applyAcceptedFinancialCorrections tests
 *
 * This is the function that would have caught a real bug before it ever ran
 * live: gap #2 of the sidecar audit found that the promotion mechanism had
 * never actually executed via real LLM output (only via a manual SQL
 * simulation). These tests exercise the real application code path.
 */

import { describe, it, expect } from 'vitest';
import { applyAcceptedFinancialCorrections } from '../apply-financial-corrections.js';
import type { FinancialFactV1 } from '@dealdecision/core';
import type { CorrectionLineageItem } from '@dealdecision/core/dist/models/correction-lineage-v1';

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

function makeCorrection(overrides: Partial<CorrectionLineageItem> = {}): CorrectionLineageItem {
	return {
		correction_id: 'corr-test-0001',
		source: 'llm_financial_verification',
		original_field: 'factv1:deal-001:revenue:unknown:current:abc123',
		original_value: '$2B',
		proposed_field: 'financial_facts.modeled_economics',
		proposed_value: '2000000000',
		normalized_value: '2000000000',
		correction_type: 'wrong_financial_category',
		confidence: 0.9,
		evidence_refs: ['$2B lifetime revenue across this very modest rollout'],
		validator_status: 'accepted',
		validator_reason: null,
		applied_to_scoring: false,
		applied_at: null,
		...overrides,
	};
}

describe('applyAcceptedFinancialCorrections', () => {
	it('mutates metric_key in place for an accepted financial-verification correction', () => {
		const fact = makeFact();
		const correction = makeCorrection();

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('modeled_economics');
		expect(applied).toHaveLength(1);
		expect(applied[0].originalMetricKey).toBe('revenue');
		expect(applied[0].newMetricKey).toBe('modeled_economics');
	});

	it('stamps applied_to_scoring and applied_at on the correction object', () => {
		const fact = makeFact();
		const correction = makeCorrection();

		applyAcceptedFinancialCorrections([fact], [correction]);

		expect(correction.applied_to_scoring).toBe(true);
		expect(correction.applied_at).not.toBeNull();
		expect(() => new Date(correction.applied_at as string).toISOString()).not.toThrow();
	});

	it('does NOT apply a needs_review correction', () => {
		const fact = makeFact();
		const correction = makeCorrection({ validator_status: 'needs_review' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
		expect(correction.applied_to_scoring).toBe(false);
	});

	it('does NOT apply a rejected correction', () => {
		const fact = makeFact();
		const correction = makeCorrection({ validator_status: 'rejected', validator_reason: 'missing_evidence_refs' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});

	it('does NOT apply a shadow_only correction', () => {
		const fact = makeFact();
		const correction = makeCorrection({ validator_status: 'shadow_only' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});

	it('does NOT apply an accepted correction from the Field Auditor (wrong source)', () => {
		const fact = makeFact();
		const correction = makeCorrection({ source: 'llm_field_audit' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});

	it('ignores a correction whose original_field does not match any fact_id', () => {
		const fact = makeFact();
		const correction = makeCorrection({ original_field: 'factv1:deal-001:revenue:unknown:current:does-not-exist' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});

	it('is a no-op when proposed_field re-confirms the same metric_key', () => {
		// Guards against ever applying an "accepted" correction that would be a
		// same-classification confirmation rather than a real reclassification —
		// this should never happen given the validator's accept rule, but the
		// function defends against it directly rather than trusting that alone.
		const fact = makeFact();
		const correction = makeCorrection({ proposed_field: 'financial_facts.revenue' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});

	it('ignores a proposed_field without the financial_facts. prefix', () => {
		const fact = makeFact();
		const correction = makeCorrection({ proposed_field: 'modeled_economics' });

		const applied = applyAcceptedFinancialCorrections([fact], [correction]);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});

	it('applies multiple independent accepted corrections in one call', () => {
		const revenueFact = makeFact();
		const raiseFact = makeFact({
			fact_id: 'factv1:deal-001:raise_amount:unknown:current:def456',
			metric_key: 'raise_amount',
			value: 150_000_000,
		});
		const corrections = [
			makeCorrection(),
			makeCorrection({
				correction_id: 'corr-test-0002',
				original_field: 'factv1:deal-001:raise_amount:unknown:current:def456',
				proposed_field: 'financial_facts.debt_facility',
			}),
		];

		const applied = applyAcceptedFinancialCorrections([revenueFact, raiseFact], corrections);

		expect(revenueFact.metric_key).toBe('modeled_economics');
		expect(raiseFact.metric_key).toBe('debt_facility');
		expect(applied).toHaveLength(2);
	});

	it('returns an empty array and mutates nothing given an empty corrections list', () => {
		const fact = makeFact();

		const applied = applyAcceptedFinancialCorrections([fact], []);

		expect(fact.metric_key).toBe('revenue');
		expect(applied).toHaveLength(0);
	});
});
