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
  humanizeActionRationale,
  humanizeActionTitle,
  humanizeContradictionType,
  humanizeCriticalFieldName,
  humanizeEvidenceRefs,
  normalizeDeepDiveText,
} from '../../lib/deepDiveHumanization';

type DealDeepDiveTabProps = {
  deepDiveResponse: DealDeepDiveResponse | null;
  loading: boolean;
  error: string | null;
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

export function DealDeepDiveTab({ deepDiveResponse, loading, error, debugEnabled = false }: DealDeepDiveTabProps) {
  const [activeSection, setActiveSection] = useState('market');

  const deepDive = deepDiveResponse?.deep_dive ?? null;

  const handleSectionClick = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
  };

  const sourceCoverage = useMemo(() => {
    if (!deepDive) return { strong: 0, moderate: 0, weak: 100 };
    const values = [
      deepDive.discovery.sources.dio_present,
      deepDive.discovery.sources.report_present,
      deepDive.discovery.sources.investor_orchestrator_present,
      deepDive.discovery.sources.financial_breakdown_present,
      deepDive.discovery.sources.underwriting_readiness_present,
    ];
    const strong = Math.round((values.filter(Boolean).length / values.length) * 100);
    return { strong, moderate: 100 - strong, weak: 0 };
  }, [deepDive]);

  const headerTitle = 'Deal Deep Dive';

  const criticalFactSummary = deepDive?.gap.missing_critical_facts
    .map((k) => humanizeCriticalFieldName(k))
    .slice(0, 3)
    .join(', ');

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-8 rounded-xl">
      <div className="max-w-[1600px] mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl text-white">{headerTitle}</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Investor-facing diligence synthesis from structured and extracted evidence.
          </p>
          {debugEnabled && deepDive && (
            <p className="text-xs text-zinc-500 mt-2">
              Debug metadata: schema {deepDive.schema_version} · analysis version {deepDive.analysis_version ?? 'N/A'} · generated {new Date(deepDive.generated_at).toLocaleString()}.
            </p>
          )}
        </div>

        {loading && (
          <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-6 mb-6 flex items-center gap-3 text-zinc-300">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading deep-dive analysis...
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 mb-6 flex items-center gap-3 text-red-200">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {!loading && !error && !deepDive && (
          <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-6 mb-6 text-zinc-300">
            <div className="font-medium mb-1">Deep dive is not available yet</div>
            <div className="text-sm text-zinc-400">
              {deepDiveResponse?.reason === 'analysis_not_started'
                ? 'Run deal analysis first to generate deterministic deep-dive output.'
                : 'No deep-dive payload was returned for this deal.'}
            </div>
          </div>
        )}

        {deepDive && (
          <>
            <div id="framing" className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 rounded-[14px] p-8 mb-6">
              <h2 className="text-xl text-white mb-3">Deal Framing</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-zinc-500">Open diligence items</div>
                  <div className="text-zinc-300">{deepDive.gap.diligence_open_items.length}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Verification requests</div>
                  <div className="text-zinc-300">{deepDive.gap.verification_requests.length}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Missing key inputs</div>
                  <div className="text-zinc-300">{criticalFactSummary || 'No critical gaps detected'}</div>
                </div>
              </div>
            </div>

            {debugEnabled && (
              <CollapsibleSection
                title="0. Discovery"
                id="discovery"
                defaultOpen={true}
                evidenceCoverage={sourceCoverage}
              >
                <SubSection
                  title="Source Availability"
                  summary={`DIO: ${deepDive.discovery.sources.dio_present ? 'present' : 'missing'}; report: ${deepDive.discovery.sources.report_present ? 'present' : 'missing'}; investor orchestrator: ${deepDive.discovery.sources.investor_orchestrator_present ? 'present' : 'missing'}.`}
                  evidenceStrength={sourceCoverage.strong >= 80 ? 'strong' : sourceCoverage.strong >= 40 ? 'moderate' : 'weak'}
                  strengths={[
                    `Financial breakdown: ${deepDive.discovery.sources.financial_breakdown_present ? 'present' : 'missing'}`,
                    `Underwriting readiness: ${deepDive.discovery.sources.underwriting_readiness_present ? 'present' : 'missing'}`,
                  ]}
                  weaknesses={deepDive.gap.missing_critical_facts.map((k) => `Missing key input: ${humanizeCriticalFieldName(k)}`)}
                />

                <SubSection
                  title="Gap Summary"
                  summary="Critical data and diligence gaps that block stronger underwriting confidence."
                  evidenceStrength={deepDive.gap.missing_critical_facts.length > 0 ? 'weak' : 'moderate'}
                  weaknesses={deepDive.gap.missing_critical_facts.map((k) => `Missing key input: ${humanizeCriticalFieldName(k)}`)}
                  openQuestions={deepDive.gap.verification_requests.map((v) => normalizeDeepDiveText(v))}
                />
              </CollapsibleSection>
            )}

            <div className="flex gap-8">
              <aside className="hidden lg:block">
                <SideNavigation activeSection={activeSection} onSectionClick={handleSectionClick} />
              </aside>

              <main className="flex-1 min-w-0">
                <CollapsibleSection title="1. Market" id="market" evidenceCoverage={sourceCoverage}>
                  <SubSection
                    title="TAM Realism"
                    summary={normalizeDeepDiveText(firstText(deepDive.market.tam_reasoning.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.market.tam_reasoning.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.market.tam_reasoning.evidence_refs)}
                  />
                  <SubSection
                    title="Market Timing"
                    summary={normalizeDeepDiveText(firstText(deepDive.market.timing_logic.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.market.timing_logic.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.market.timing_logic.evidence_refs)}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="2. Product" id="product" evidenceCoverage={sourceCoverage}>
                  <SubSection
                    title="Differentiation Detection"
                    summary={normalizeDeepDiveText(firstText(deepDive.product.differentiation_detection.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.product.differentiation_detection.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.product.differentiation_detection.evidence_refs)}
                  />
                  <SubSection
                    title="Defensibility Logic"
                    summary={normalizeDeepDiveText(firstText(deepDive.product.defensibility_logic.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.product.defensibility_logic.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.product.defensibility_logic.evidence_refs)}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="3. Business Model" id="business-model" evidenceCoverage={sourceCoverage}>
                  <SubSection
                    title="Revenue Model Inference"
                    summary={normalizeDeepDiveText(deepDive.business_model.revenue_model_inference.inferred_model ?? 'The current materials do not provide a clearly supported revenue model.')}
                    evidenceStrength={toEvidenceStrength(deepDive.business_model.revenue_model_inference.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.business_model.revenue_model_inference.evidence_refs)}
                  />
                  <SubSection
                    title="Scaling Logic"
                    summary={normalizeDeepDiveText(firstText(deepDive.business_model.scaling_logic.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.business_model.scaling_logic.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.business_model.scaling_logic.evidence_refs)}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="4. Traction" id="traction" evidenceCoverage={sourceCoverage}>
                  <SubSection
                    title="Growth Validation"
                    summary={normalizeDeepDiveText(firstText(deepDive.traction.growth_validation.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.traction.growth_validation.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.traction.growth_validation.evidence_refs)}
                  />
                  <SubSection
                    title="Proof vs Promise"
                    summary={normalizeDeepDiveText(firstText(deepDive.traction.proof_vs_promise_detection.notes))}
                    evidenceStrength={toEvidenceStrength(deepDive.traction.proof_vs_promise_detection.evidence_strength)}
                    evidence={humanizeEvidenceRefs(deepDive.traction.proof_vs_promise_detection.evidence_refs)}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="5. Financials" id="financials" evidenceCoverage={sourceCoverage}>
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
                  />
                </CollapsibleSection>

                <CollapsibleSection title="6. Team" id="team" evidenceCoverage={sourceCoverage}>
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
                  />
                </CollapsibleSection>

                <CollapsibleSection title="7. Risks" id="risks" evidenceCoverage={sourceCoverage}>
                  <div className="grid md:grid-cols-2 gap-4">
                    {deepDive.risks.classification.length > 0 ? deepDive.risks.classification.map((risk) => (
                      <RiskCard
                        key={`${risk.category}:${risk.risk}`}
                        type={risk.category}
                        severity={toSeverity(risk.severity)}
                        description={normalizeDeepDiveText(risk.risk)}
                        evidence={humanizeEvidenceRefs(risk.evidence_refs).join(' | ') || 'Source material'}
                      />
                    )) : (
                      <div className="text-zinc-400 text-sm">No risk classifications were returned.</div>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="8. Red Flags" id="red-flags" evidenceCoverage={sourceCoverage}>
                  <div className="space-y-4">
                    {deepDive.red_flags.items.length > 0 ? deepDive.red_flags.items.map((item, idx) => (
                      <RedFlagCard
                        key={`${item.flag}:${idx}`}
                        title={normalizeDeepDiveText(item.flag)}
                        description={humanizeContradictionType(item.contradiction_type)}
                        impact={toImpact(item.contradiction_type)}
                        source={humanizeEvidenceRefs(item.evidence_refs).join(' | ') || 'Source material'}
                        isContradiction={true}
                      />
                    )) : (
                      <div className="text-zinc-400 text-sm">No red flags were returned.</div>
                    )}
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="9. Open Questions & Unknowns" id="open-questions" evidenceCoverage={sourceCoverage}>
                  <OpenQuestionsGrid
                    categories={[
                      {
                        title: 'Prioritized Questions',
                        questions: deepDive.open_questions.prioritized.map((q) => ({
                          text: normalizeDeepDiveText(q.question),
                          priority: toQuestionPriority(q.priority),
                        })),
                      },
                      {
                        title: 'Implementation Actions',
                        questions: deepDive.implementation.actions.map((a) => ({
                          text: `${humanizeActionTitle(a.title)} ${humanizeActionRationale(a.rationale)}`,
                          priority: a.priority === 'high' ? 'critical' : a.priority === 'medium' ? 'important' : 'low',
                        })),
                      },
                    ]}
                  />
                </CollapsibleSection>
              </main>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
