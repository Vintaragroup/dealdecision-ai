import { useMemo, useState } from 'react';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import { CollapsibleSection } from './Deal-Deep-Dive/collapsible-section';
import { SubSection } from './Deal-Deep-Dive/sub-section';
import { RiskCard } from './Deal-Deep-Dive/risk-card';
import { RedFlagCard } from './Deal-Deep-Dive/red-flag-card';
import { OpenQuestionsGrid } from './Deal-Deep-Dive/open-questions-grid';
import { SideNavigation } from './Deal-Deep-Dive/side-navigation';
import type { DealDeepDiveResponse, DealDeepDiveV1 } from '../../lib/apiClient';
import {
  humanizeImplementationActionText,
  humanizeOpenQuestionText,
  humanizeContradictionType,
  humanizeCriticalFieldName,
  humanizeEvidenceRefs,
  normalizeDeepDiveText,
} from '../../lib/deepDiveHumanization';

type DealDeepDiveTabProps = {
  deepDiveResponse: DealDeepDiveResponse | null;
  loading: boolean;
  error: string | null;
  darkMode?: boolean;
  debugEnabled?: boolean;
};

const toEvidenceStrength = (
  value: DealDeepDiveV1['market']['tam_reasoning']['evidence_strength']
): 'strong' | 'moderate' | 'weak' | 'missing' => {
  if (value === 'strong') return 'strong';
  if (value === 'moderate') return 'moderate';
  if (value === 'weak') return 'weak';
  return 'missing';
};

const firstText = (items: string[]): string => {
  const val = items.find((x) => typeof x === 'string' && x.trim().length > 0);
  return val ?? 'No deterministic notes available for this area yet.';
};

const toSeverity = (value: string): 'low' | 'medium' | 'high' => {
  if (value === 'critical' || value === 'high') return 'high';
  if (value === 'medium') return 'medium';
  return 'low';
};

const toImpact = (value: string): 'medium' | 'high' | 'critical' => {
  if (value === 'missing_critical') return 'critical';
  if (value === 'numeric_divergence' || value === 'semantic_divergence') return 'high';
  return 'medium';
};

const toQuestionPriority = (value: string): 'critical' | 'important' | 'low' => {
  if (value === 'p0') return 'critical';
  if (value === 'p1') return 'important';
  return 'low';
};

const toSectionCoverage = (strengths: Array<DealDeepDiveV1['market']['tam_reasoning']['evidence_strength'] | undefined>): {
  strong: number;
  moderate: number;
  weak: number;
} | undefined => {
  const values = strengths.filter((s): s is DealDeepDiveV1['market']['tam_reasoning']['evidence_strength'] => Boolean(s));
  if (values.length === 0) return undefined;

  const total = values.length;
  const strong = Math.round((values.filter((s) => s === 'strong').length / total) * 100);
  const moderate = Math.round((values.filter((s) => s === 'moderate').length / total) * 100);
  const weak = Math.max(0, 100 - strong - moderate);

  return { strong, moderate, weak };
};

const dedupeByText = <T extends { text: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = normalizeDeepDiveText(item.text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

export function DealDeepDiveTab({ deepDiveResponse, loading, error, darkMode = true, debugEnabled = false }: DealDeepDiveTabProps) {
  const [activeSection, setActiveSection] = useState('market');

  const deepDive = deepDiveResponse?.deep_dive ?? null;

  const handleSectionClick = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
  };

  const sectionCoverage = useMemo(() => {
    if (!deepDive) {
      return {
        market: undefined,
        product: undefined,
        businessModel: undefined,
        traction: undefined,
        financials: undefined,
        team: undefined,
      };
    }

    return {
      market: toSectionCoverage([
        deepDive.market.tam_reasoning.evidence_strength,
        deepDive.market.timing_logic.evidence_strength,
      ]),
      product: toSectionCoverage([
        deepDive.product.differentiation_detection.evidence_strength,
        deepDive.product.defensibility_logic.evidence_strength,
      ]),
      businessModel: toSectionCoverage([
        deepDive.business_model.revenue_model_inference.evidence_strength,
        deepDive.business_model.scaling_logic.evidence_strength,
      ]),
      traction: toSectionCoverage([
        deepDive.traction.growth_validation.evidence_strength,
        deepDive.traction.proof_vs_promise_detection.evidence_strength,
      ]),
      financials: toSectionCoverage([
        deepDive.financials.interpretation_layer.evidence_strength,
      ]),
      team: toSectionCoverage([
        deepDive.team.capability_inference.evidence_strength,
      ]),
    };
  }, [deepDive]);

  const openQuestionItems = useMemo(() => {
    if (!deepDive) return [] as Array<{ text: string; priority: 'critical' | 'important' | 'low' }>;

    const normalized = deepDive.open_questions.prioritized.map((q) => ({
      text: humanizeOpenQuestionText(q.question),
      priority: toQuestionPriority(q.priority),
    }));

    return dedupeByText(normalized);
  }, [deepDive]);

  const actionItems = useMemo(() => {
    if (!deepDive) return [] as Array<{ text: string; priority: 'critical' | 'important' | 'low' }>;

    const contradictionSeen = new Set<string>();
    const normalized = deepDive.implementation.actions
      .map((a) => {
        const text = humanizeImplementationActionText(a.title, a.rationale);
        if (a.action_id.startsWith('red_flag:')) {
          const key = normalizeDeepDiveText(text).replace(/\b(this inconsistency|reconcile conflicting evidence in a single source-of-truth summary)\b/gi, '').toLowerCase();
          if (contradictionSeen.has(key)) return null;
          contradictionSeen.add(key);
        }
        return {
          text,
          priority: a.priority === 'high' ? 'critical' as const : a.priority === 'medium' ? 'important' as const : 'low' as const,
        };
      })
      .filter((item): item is { text: string; priority: 'critical' | 'important' | 'low' } => Boolean(item));

    return dedupeByText(normalized);
  }, [deepDive]);

  const headerTitle = 'Deal Deep Dive';

  const criticalFactSummary = deepDive?.gap.missing_critical_facts
    .map((k) => humanizeCriticalFieldName(k))
    .slice(0, 3)
    .join(', ');

  const surfaceClass = darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200';
  const titleClass = darkMode ? 'text-white' : 'text-gray-900';
  const bodyClass = darkMode ? 'text-gray-300' : 'text-gray-700';
  const mutedClass = darkMode ? 'text-gray-400' : 'text-gray-600';
  const subtleClass = darkMode ? 'text-gray-500' : 'text-gray-500';

  return (
    <div className="w-full max-w-none space-y-6">
      <div className={`rounded-xl border p-6 ${surfaceClass}`}>
        <div className="mb-1">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-6 h-6 text-blue-400" />
            <h1 className={`text-2xl ${titleClass}`}>{headerTitle}</h1>
          </div>
          <p className={`text-sm ${mutedClass}`}>
            Investor-facing diligence synthesis from structured and extracted evidence.
          </p>
          {debugEnabled && deepDive && (
            <p className={`text-xs mt-2 ${subtleClass}`}>
              Debug metadata: schema {deepDive.schema_version} · analysis version {deepDive.analysis_version ?? 'N/A'} · generated {new Date(deepDive.generated_at).toLocaleString()}.
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className={`rounded-xl border p-6 flex items-center gap-3 ${surfaceClass} ${bodyClass}`}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading deep-dive analysis...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 flex items-center gap-3 text-red-300">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {!loading && !error && !deepDive && (
        <div className={`rounded-xl border p-6 ${surfaceClass}`}>
          <div className={`font-medium mb-1 ${titleClass}`}>Deep dive is not available yet</div>
          <div className={`text-sm ${mutedClass}`}>
            {deepDiveResponse?.reason === 'analysis_not_started'
              ? 'Run deal analysis first to generate deterministic deep-dive output.'
              : 'No deep-dive payload was returned for this deal.'}
          </div>
        </div>
      )}

      {deepDive && (
        <>
          <div id="framing" className={`rounded-xl border p-6 ${surfaceClass}`}>
              <h2 className={`text-sm uppercase tracking-wide mb-4 ${mutedClass}`}>Deal Framing</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className={subtleClass}>Open diligence items</div>
                  <div className={bodyClass}>{deepDive.gap.diligence_open_items.length}</div>
                </div>
                <div>
                  <div className={subtleClass}>Verification requests</div>
                  <div className={bodyClass}>{deepDive.gap.verification_requests.length}</div>
                </div>
                <div>
                  <div className={subtleClass}>Missing key inputs</div>
                  <div className={bodyClass}>{criticalFactSummary || 'No critical gaps detected'}</div>
                </div>
              </div>
            </div>

            {debugEnabled && (
              <CollapsibleSection
                title="0. Discovery"
                id="discovery"
                defaultOpen={true}
                darkMode={darkMode}
              >
                <SubSection
                  title="Source Availability"
                  summary={`DIO: ${deepDive.discovery.sources.dio_present ? 'present' : 'missing'}; report: ${deepDive.discovery.sources.report_present ? 'present' : 'missing'}; investor orchestrator: ${deepDive.discovery.sources.investor_orchestrator_present ? 'present' : 'missing'}.`}
                  evidenceStrength={deepDive.discovery.sources.report_present && deepDive.discovery.sources.investor_orchestrator_present ? 'moderate' : 'weak'}
                  strengths={[
                    `Financial breakdown: ${deepDive.discovery.sources.financial_breakdown_present ? 'present' : 'missing'}`,
                    `Underwriting readiness: ${deepDive.discovery.sources.underwriting_readiness_present ? 'present' : 'missing'}`,
                  ]}
                  weaknesses={deepDive.gap.missing_critical_facts.map((k) => `Missing key input: ${humanizeCriticalFieldName(k)}`)}
                  darkMode={darkMode}
                />

                <SubSection
                  title="Gap Summary"
                  summary="Critical data and diligence gaps that block stronger underwriting confidence."
                  evidenceStrength={deepDive.gap.missing_critical_facts.length > 0 ? 'weak' : 'moderate'}
                  weaknesses={deepDive.gap.missing_critical_facts.map((k) => `Missing key input: ${humanizeCriticalFieldName(k)}`)}
                  openQuestions={deepDive.gap.verification_requests.map((v) => normalizeDeepDiveText(v))}
                  darkMode={darkMode}
                />
              </CollapsibleSection>
            )}

            <div className="flex gap-6">
              <aside className="hidden lg:block">
                <SideNavigation activeSection={activeSection} onSectionClick={handleSectionClick} darkMode={darkMode} />
              </aside>

              <main className="flex-1 min-w-0">
                <CollapsibleSection title="1. Market" id="market" evidenceCoverage={sectionCoverage.market} darkMode={darkMode}>
                  <SubSection
                    title="TAM Realism"
                    summary={normalizeDeepDiveText(firstText(deepDive.market.tam_reasoning.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.market.tam_reasoning.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.market.tam_reasoning.evidence_refs)}
                    darkMode={darkMode}
                  />
                  <SubSection
                    title="Market Timing"
                    summary={normalizeDeepDiveText(firstText(deepDive.market.timing_logic.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.market.timing_logic.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.market.timing_logic.evidence_refs)}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="2. Product" id="product" evidenceCoverage={sectionCoverage.product} darkMode={darkMode}>
                  <SubSection
                    title="Differentiation Detection"
                    summary={normalizeDeepDiveText(firstText(deepDive.product.differentiation_detection.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.product.differentiation_detection.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.product.differentiation_detection.evidence_refs)}
                    darkMode={darkMode}
                  />
                  <SubSection
                    title="Defensibility Logic"
                    summary={normalizeDeepDiveText(firstText(deepDive.product.defensibility_logic.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.product.defensibility_logic.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.product.defensibility_logic.evidence_refs)}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="3. Business Model" id="business-model" evidenceCoverage={sectionCoverage.businessModel} darkMode={darkMode}>
                  <SubSection
                    title="Revenue Model Inference"
                    summary={normalizeDeepDiveText(deepDive.business_model.revenue_model_inference.inferred_model ?? 'The current materials do not provide a clearly supported revenue model.')}
                    evidenceStrength={toEvidenceStrength(deepDive.business_model.revenue_model_inference.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.business_model.revenue_model_inference.evidence_refs)}
                    darkMode={darkMode}
                  />
                  <SubSection
                    title="Scaling Logic"
                    summary={normalizeDeepDiveText(firstText(deepDive.business_model.scaling_logic.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.business_model.scaling_logic.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.business_model.scaling_logic.evidence_refs)}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="4. Traction" id="traction" evidenceCoverage={sectionCoverage.traction} darkMode={darkMode}>
                  <SubSection
                    title="Growth Validation"
                    summary={normalizeDeepDiveText(firstText(deepDive.traction.growth_validation.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.traction.growth_validation.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.traction.growth_validation.evidence_refs)}
                    darkMode={darkMode}
                  />
                  <SubSection
                    title="Proof vs Promise"
                    summary={normalizeDeepDiveText(firstText(deepDive.traction.proof_vs_promise_detection.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.traction.proof_vs_promise_detection.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.traction.proof_vs_promise_detection.evidence_refs)}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="5. Financials" id="financials" evidenceCoverage={sectionCoverage.financials} darkMode={darkMode}>
                  <SubSection
                    title="Interpretation Layer"
                    summary={
                      deepDive.financials.interpretation_layer.current_state_signals.length > 0
                        ? normalizeDeepDiveText(deepDive.financials.interpretation_layer.current_state_signals.join(' '))
                        : 'The current materials do not provide enough evidence to form a reliable current-state financial view.'
                    }
                    evidenceStrength={toEvidenceStrength(deepDive.financials.interpretation_layer.evidence_strength)}
                    strengths={deepDive.financials.interpretation_layer.current_state_signals.map((s) => normalizeDeepDiveText(s))}
                    openQuestions={deepDive.financials.interpretation_layer.forward_view_signals.map((s) => normalizeDeepDiveText(s))}
                    evidence={humanizeEvidenceRefs(deepDive.financials.interpretation_layer.evidence_refs)}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="6. Team" id="team" evidenceCoverage={sectionCoverage.team} darkMode={darkMode}>
                  <SubSection
                    title="Capability Inference"
                    summary={
                      deepDive.team.capability_inference.inferred_capabilities.length > 0
                        ? normalizeDeepDiveText(deepDive.team.capability_inference.inferred_capabilities.join(' '))
                        : 'The current materials provide limited support for a strong team capability view.'
                    }
                    evidenceStrength={toEvidenceStrength(deepDive.team.capability_inference.evidence_strength)}
                    strengths={deepDive.team.capability_inference.inferred_capabilities.map((s) => normalizeDeepDiveText(s))}
                    evidence={humanizeEvidenceRefs(deepDive.team.capability_inference.evidence_refs)}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="7. Risks" id="risks" darkMode={darkMode}>
                  <div className="grid md:grid-cols-2 gap-4">
                    {deepDive.risks.classification.length > 0 ? deepDive.risks.classification.map((risk) => (
                      <RiskCard
                        key={`${risk.category}:${risk.risk}`}
                        type={risk.category}
                        severity={toSeverity(risk.severity)}
                        description={normalizeDeepDiveText(risk.risk)}
                        evidence={humanizeEvidenceRefs(risk.evidence_refs).join(' | ') || 'Source material'}
                        darkMode={darkMode}
                      />
                    )) : (
                      <div className={`text-sm ${mutedClass}`}>No risk classifications were returned.</div>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="8. Red Flags" id="red-flags" darkMode={darkMode}>
                  <div className="space-y-4">
                    {deepDive.red_flags.items.length > 0 ? deepDive.red_flags.items.map((item, idx) => (
                      <RedFlagCard
                        key={`${item.flag}:${idx}`}
                        title={normalizeDeepDiveText(item.flag)}
                        description={humanizeContradictionType(item.contradiction_type)}
                        impact={toImpact(item.contradiction_type)}
                        source={humanizeEvidenceRefs(item.evidence_refs).join(' | ') || 'Source material'}
                        isContradiction={true}
                        darkMode={darkMode}
                      />
                    )) : (
                      <div className={`text-sm ${mutedClass}`}>No red flags were returned.</div>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="9. Open Questions & Unknowns" id="open-questions" darkMode={darkMode}>
                  <OpenQuestionsGrid
                    categories={[
                      {
                        title: 'Prioritized Questions',
                        questions: openQuestionItems,
                      },
                      {
                        title: 'Implementation Actions',
                        questions: actionItems,
                      },
                    ]}
                    darkMode={darkMode}
                  />
                </CollapsibleSection>
              </main>
            </div>
        </>
      )}
    </div>
  );
}
