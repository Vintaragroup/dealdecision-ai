export type PolicyFamily = 'startup' | 'real_estate' | 'fund' | 'other';

export type SelectedPolicyResolutionSource =
  | 'selectedPolicyId'
  | 'selected_policy'
  | 'policy_id'
  | 'deal_classification_v1.selected_policy'
  | 'dio.deal_classification_v1.selected_policy'
  | 'dio.dio.deal_classification_v1.selected_policy'
  | 'phase1.deal_classification_v1.selected_policy'
  | 'dio.phase1.deal_classification_v1.selected_policy'
  | 'deep_search.deal_classification_v1.selected_policy'
  | 'not_found';

export type SelectedPolicyResolution = {
  policyId: string | null;
  source: SelectedPolicyResolutionSource;
  usedFallback: boolean;
};

export function getPolicyFamily(policyId: string | null | undefined): PolicyFamily {
  const pid = typeof policyId === 'string' ? policyId.trim().toLowerCase() : '';
  if (!pid) return 'other';
  if (pid === 'real_estate_underwriting' || pid.includes('real_estate')) return 'real_estate';
  if (pid === 'fund_spv' || pid.includes('fund') || pid.includes('spv')) return 'fund';
  if (
    pid === 'startup_raise' ||
    pid === 'operating_startup_revenue_v1' ||
    pid === 'enterprise_saas_b2b_v1' ||
    pid === 'consumer_ecommerce_brand_v1' ||
    pid === 'consumer_fintech_platform_v1' ||
    pid === 'healthcare_biotech_v1' ||
    pid === 'media_entertainment_ip_v1' ||
    pid === 'physical_product_cpg_spirits_v1'
  ) {
    return 'startup';
  }
  return 'other';
}

export function getPolicyScoreSectionLabel(policyId: string | null | undefined, key: string): string {
  const family = getPolicyFamily(policyId);
  const k = String(key || '').trim().toLowerCase();

  if (family === 'real_estate') {
    if (k === 'traction') return 'Underwriting metrics';
    if (k === 'business_model') return 'Deal structure';
    if (k === 'market') return 'Submarket / demand';
  }

  if (family === 'fund') {
    if (k === 'traction') return 'Portfolio construction';
    if (k === 'business_model') return 'Fund strategy';
    if (k === 'market') return 'Target allocation';
  }

  if (k === 'business_model') return 'Business model';
  if (k === 'traction') return 'Traction';
  if (k === 'market') return 'Market';
  if (k === 'product') return 'Product';
  if (k === 'team') return 'Team';
  if (k === 'risks') return 'Risks';
  if (k === 'icp') return 'ICP';
  return key;
}

function asNonEmptyPolicy(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

export function resolveSelectedPolicyIdFromAny(dioLike: any): SelectedPolicyResolution {
  const orderedCandidates: Array<{ source: SelectedPolicyResolutionSource; value: unknown }> = [
    { source: 'selectedPolicyId', value: dioLike?.selectedPolicyId },
    { source: 'selected_policy', value: dioLike?.selected_policy },
    { source: 'policy_id', value: dioLike?.policy_id },
    { source: 'deal_classification_v1.selected_policy', value: dioLike?.deal_classification_v1?.selected_policy },
    { source: 'dio.deal_classification_v1.selected_policy', value: dioLike?.dio?.deal_classification_v1?.selected_policy },
    { source: 'dio.dio.deal_classification_v1.selected_policy', value: dioLike?.dio?.dio?.deal_classification_v1?.selected_policy },
    { source: 'phase1.deal_classification_v1.selected_policy', value: dioLike?.phase1?.deal_classification_v1?.selected_policy },
    { source: 'dio.phase1.deal_classification_v1.selected_policy', value: dioLike?.dio?.phase1?.deal_classification_v1?.selected_policy },
  ];

  for (const candidate of orderedCandidates) {
    const policyId = asNonEmptyPolicy(candidate.value);
    if (policyId) {
      return {
        policyId,
        source: candidate.source,
        usedFallback: false,
      };
    }
  }

  try {
    const seen = new Set<any>();
    const stack: any[] = [dioLike];

    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (seen.has(cur)) continue;
      seen.add(cur);

      const policyId = asNonEmptyPolicy((cur as any)?.deal_classification_v1?.selected_policy);
      if (policyId) {
        return {
          policyId,
          source: 'deep_search.deal_classification_v1.selected_policy',
          usedFallback: true,
        };
      }

      for (const key of Object.keys(cur)) {
        const child = (cur as any)[key];
        if (child && typeof child === 'object') stack.push(child);
      }
    }
  } catch {
    // ignore and return not_found
  }

  return {
    policyId: null,
    source: 'not_found',
    usedFallback: true,
  };
}
