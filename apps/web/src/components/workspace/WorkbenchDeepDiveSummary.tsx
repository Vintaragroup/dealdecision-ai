import type { DealDeepDiveV1 } from '../../lib/apiClient';

type SectionHealth = {
  key: string;
  label: string;
  strength: 'strong' | 'moderate' | 'weak' | 'none';
};

function collectSectionHealth(dd: DealDeepDiveV1): SectionHealth[] {
  const sections: SectionHealth[] = [
    { key: 'market', label: 'Market', strength: strongest(dd.market.tam_reasoning.evidence_strength, dd.market.timing_logic.evidence_strength) },
    { key: 'product', label: 'Product', strength: strongest(dd.product.differentiation_detection.evidence_strength, dd.product.defensibility_logic.evidence_strength) },
    { key: 'business_model', label: 'Business Model', strength: dd.business_model.revenue_model_inference.evidence_strength },
    { key: 'traction', label: 'Traction', strength: strongest(dd.traction.growth_validation.evidence_strength, dd.traction.proof_vs_promise_detection.evidence_strength) },
    { key: 'team', label: 'Team', strength: dd.team.capability_inference.evidence_strength },
    { key: 'financials', label: 'Financials', strength: dd.financials.interpretation_layer.evidence_strength },
  ];
  return sections;
}

const STRENGTH_ORDER: Record<string, number> = { strong: 3, moderate: 2, weak: 1, none: 0 };

function strongest(
  a: 'strong' | 'moderate' | 'weak' | 'none',
  b: 'strong' | 'moderate' | 'weak' | 'none'
): 'strong' | 'moderate' | 'weak' | 'none' {
  return (STRENGTH_ORDER[a] ?? 0) >= (STRENGTH_ORDER[b] ?? 0) ? a : b;
}

interface Props {
  deepDive: DealDeepDiveV1 | null;
  loading: boolean;
  error: string | null;
  darkMode: boolean;
  onOpenFull?: () => void;
}

export function WorkbenchDeepDiveSummary({ deepDive, loading, error, darkMode, onOpenFull }: Props) {
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const sub = darkMode ? 'text-gray-300' : 'text-gray-700';
  const cardBg = darkMode ? 'bg-white/[0.03]' : 'bg-gray-50';

  if (loading) {
    return (
      <div className={`p-4 space-y-2 border-t ${border}`}>
        <div className={`text-xs ${muted}`}>Loading deep dive…</div>
      </div>
    );
  }

  if (error || !deepDive) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted} mb-3`}>Summary not available yet.</div>
        {onOpenFull && (
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full deep dive
          </button>
        )}
      </div>
    );
  }

  const sections = collectSectionHealth(deepDive);
  const strong = sections.filter((s) => s.strength === 'strong' || s.strength === 'moderate');
  const weak = sections.filter((s) => s.strength === 'weak' || s.strength === 'none');
  // Exclude items whose contradiction_type is 'missing_critical' — those represent
  // absent evidence, not actual contradictions between two conflicting signals.
  // missing_critical items are already surfaced under gap.missing_critical_facts.
  const redFlags = (deepDive.red_flags?.items ?? []).filter(
    (f) => f.contradiction_type !== 'missing_critical'
  );
  const topQuestions = (deepDive.open_questions?.prioritized ?? []).filter((q) => q.priority === 'p0' || q.priority === 'p1').slice(0, 3);
  const missingFacts = (deepDive.gap?.missing_critical_facts ?? []).slice(0, 3);
  const hasContent = strong.length > 0 || weak.length > 0 || redFlags.length > 0 || topQuestions.length > 0;

  if (!hasContent) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted} mb-3`}>Summary not available yet.</div>
        {onOpenFull && (
          <button onClick={onOpenFull} className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
            Open full deep dive
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`border-t ${border} divide-y ${darkMode ? 'divide-white/5' : 'divide-gray-100'}`}>
      {/* Section health */}
      {(strong.length > 0 || weak.length > 0) && (
        <div className="px-4 py-3 space-y-2">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Section Health</div>
          <div className="flex flex-wrap gap-1.5">
            {sections.map((s) => {
              const cls =
                s.strength === 'strong'
                  ? darkMode ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : s.strength === 'moderate'
                  ? darkMode ? 'bg-blue-500/10 text-blue-300 border-blue-500/20' : 'bg-blue-50 text-blue-700 border-blue-200'
                  : s.strength === 'weak'
                  ? darkMode ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-amber-50 text-amber-700 border-amber-200'
                  : darkMode ? 'bg-white/5 text-gray-400 border-white/10' : 'bg-gray-100 text-gray-400 border-gray-200';
              return (
                <span key={s.key} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${cls}`}>
                  {s.strength === 'strong' ? '●' : s.strength === 'moderate' ? '◐' : s.strength === 'weak' ? '○' : '–'}
                  {s.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Red flags / contradictions */}
      {redFlags.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Contradictions</div>
          {redFlags.slice(0, 3).map((f, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-red-400">⚠</span>
              <span>{f.flag}</span>
            </div>
          ))}
        </div>
      )}

      {/* Open questions */}
      {topQuestions.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Open Questions</div>
          {topQuestions.map((q, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-amber-400">?</span>
              <span>{q.question}</span>
            </div>
          ))}
        </div>
      )}

      {/* Missing critical facts */}
      {missingFacts.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Missing Evidence</div>
          {missingFacts.map((f, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs ${muted}`}>
              <span className="mt-0.5 shrink-0">–</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}

      {/* CTA footer */}
      {onOpenFull && (
        <div className={`px-4 py-3 ${cardBg}`}>
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full deep dive →
          </button>
        </div>
      )}
    </div>
  );
}
