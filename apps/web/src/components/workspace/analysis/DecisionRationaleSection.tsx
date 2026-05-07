/**
 * DecisionRationaleSection
 *
 * Renders the validated LLM decision rationale for a deal.
 *
 * RENDER CONTRACT:
 * - Only renders when `rationale.status === 'validated'`
 * - Returns null in all other cases (draft, shadow_only, rejected, missing)
 * - Does NOT mutate any scoring, conviction, or verdict field
 * - Rationale is clearly labeled as AI-generated and for decision support only
 *
 * DATA SOURCE:
 * - `report.llm_decision_rationale_v1` from the /report API response
 * - Validated by `llm_rationale_validation_v1.overall_status === 'passed'`
 *
 * @see apps/worker/src/lib/intelligence/llm-rationale-synthesizer.ts
 * @see artifacts/llm-auditor-phase-4-rationale-summary.md
 */

import React from 'react';
import { Sparkles, CheckCircle2, AlertCircle, Shield } from 'lucide-react';

// ─── Web-layer type ───────────────────────────────────────────────────────────
// Mirrors LLMDecisionRationaleV1 from @dealdecision/core.
// Duplicated to avoid cross-package dep in the web bundle.
export interface DecisionRationaleV1 {
  schema_version: 'llm_decision_rationale_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  model?: string | null;
  provider?: string | null;
  canonical_verdict: string;
  primary_reason: string;
  why_not_pass: string[];
  why_not_reject: string[];
  strongest_signals: string[];
  gating_risks: string[];
  missing_evidence: string[];
  confidence_explanation: string;
  evidence_refs: string[];
  source_quality_notes: string[];
  backend_terms_removed: string[];
  generation_warnings: string[];
  status: 'draft' | 'validated' | 'rejected' | 'shadow_only';
  validation_run_id?: string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DecisionRationaleSectionProps {
  rationale: DecisionRationaleV1 | null | undefined;
  darkMode?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DecisionRationaleSection({
  rationale,
  darkMode = false,
}: DecisionRationaleSectionProps): React.ReactElement | null {
  // RENDER GATE: only show validated rationale
  if (!rationale || rationale.status !== 'validated') {
    return null;
  }

  const card = darkMode
    ? 'bg-white/[0.02] border-white/10'
    : 'bg-white border-gray-200';
  const muted = darkMode ? 'text-gray-500' : 'text-gray-500';
  const body = darkMode ? 'text-gray-300' : 'text-gray-700';
  const heading = darkMode ? 'text-white' : 'text-gray-900';
  const subCard = darkMode ? 'bg-white/[0.03] border-white/10' : 'bg-gray-50/80 border-gray-200';
  const aiLabel = darkMode
    ? 'text-violet-400 border-violet-500/30 bg-violet-500/10'
    : 'text-violet-700 border-violet-200 bg-violet-50';
  const validatedLabel = darkMode
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : 'text-emerald-700 border-emerald-200 bg-emerald-50';

  const hasWhyNotPass = Array.isArray(rationale.why_not_pass) && rationale.why_not_pass.length > 0;
  const hasWhyNotReject = Array.isArray(rationale.why_not_reject) && rationale.why_not_reject.length > 0;
  const hasStrongestSignals = Array.isArray(rationale.strongest_signals) && rationale.strongest_signals.length > 0;
  const hasGatingRisks = Array.isArray(rationale.gating_risks) && rationale.gating_risks.length > 0;
  const hasMissingEvidence = Array.isArray(rationale.missing_evidence) && rationale.missing_evidence.length > 0;

  return (
    <section
      data-testid="decision-rationale-section"
      className={`rounded-xl border p-5 ${card}`}
      aria-label="Decision Rationale"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles
            className={`w-4 h-4 shrink-0 ${darkMode ? 'text-violet-400' : 'text-violet-600'}`}
            strokeWidth={1.5}
          />
          <div>
            <div className={`text-[10px] uppercase tracking-widest font-semibold ${muted}`}>
              Decision Rationale
            </div>
            <div className={`text-sm font-semibold mt-0.5 ${heading}`}>
              {rationale.canonical_verdict}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            data-testid="rationale-ai-badge"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${aiLabel}`}
          >
            <Sparkles className="w-2.5 h-2.5" strokeWidth={2} />
            AI-generated rationale
          </span>
          <span
            data-testid="rationale-validated-badge"
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${validatedLabel}`}
          >
            <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2} />
            Validated
          </span>
        </div>
      </div>

      {/* Primary reason */}
      {rationale.primary_reason && (
        <p
          data-testid="rationale-primary-reason"
          className={`text-sm leading-relaxed mb-4 ${body}`}
        >
          {rationale.primary_reason}
        </p>
      )}

      {/* Opposing case columns */}
      {(hasWhyNotPass || hasWhyNotReject) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {hasWhyNotReject && (
            <div
              data-testid="rationale-why-not-reject"
              className={`rounded-lg border p-3 ${subCard}`}
            >
              <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                Why not reject
              </div>
              <ul className="space-y-1.5">
                {rationale.why_not_reject.slice(0, 4).map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-emerald-500' : 'bg-emerald-500'}`} />
                    <span className={`text-[11px] leading-snug ${body}`}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasWhyNotPass && (
            <div
              data-testid="rationale-why-not-pass"
              className={`rounded-lg border p-3 ${subCard}`}
            >
              <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                Why not advance
              </div>
              <ul className="space-y-1.5">
                {rationale.why_not_pass.slice(0, 4).map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-amber-500' : 'bg-amber-500'}`} />
                    <span className={`text-[11px] leading-snug ${body}`}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Strongest signals + Gating risks */}
      {(hasStrongestSignals || hasGatingRisks) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {hasStrongestSignals && (
            <div data-testid="rationale-strongest-signals" className={`rounded-lg border p-3 ${subCard}`}>
              <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                Strongest signals
              </div>
              <ul className="space-y-1.5">
                {rationale.strongest_signals.slice(0, 4).map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-blue-500' : 'bg-blue-500'}`} />
                    <span className={`text-[11px] leading-snug ${body}`}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasGatingRisks && (
            <div data-testid="rationale-gating-risks" className={`rounded-lg border p-3 ${subCard}`}>
              <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${darkMode ? 'text-rose-400' : 'text-rose-600'}`}>
                Gating risks
              </div>
              <ul className="space-y-1.5">
                {rationale.gating_risks.slice(0, 4).map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertCircle className={`mt-1 w-3 h-3 shrink-0 ${darkMode ? 'text-rose-400' : 'text-rose-500'}`} strokeWidth={2} />
                    <span className={`text-[11px] leading-snug ${body}`}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Missing evidence */}
      {hasMissingEvidence && (
        <div data-testid="rationale-missing-evidence" className={`rounded-lg border p-3 mb-4 ${subCard}`}>
          <div className={`text-[10px] uppercase tracking-wide font-semibold mb-2 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
            Missing evidence
          </div>
          <ul className="space-y-1.5">
            {rationale.missing_evidence.slice(0, 4).map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${darkMode ? 'bg-amber-500' : 'bg-amber-500'}`} />
                <span className={`text-[11px] leading-snug ${body}`}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confidence explanation */}
      {rationale.confidence_explanation && (
        <div
          data-testid="rationale-confidence-explanation"
          className={`rounded-lg border p-3 mb-4 ${subCard}`}
        >
          <div className={`text-[10px] uppercase tracking-wide font-semibold mb-1.5 ${muted}`}>
            Confidence assessment
          </div>
          <p className={`text-[11px] leading-relaxed ${muted}`}>{rationale.confidence_explanation}</p>
        </div>
      )}

      {/* Footer disclaimer */}
      <div
        data-testid="rationale-disclaimer"
        className={`flex items-start gap-2 pt-3 border-t ${darkMode ? 'border-white/5' : 'border-gray-100'}`}
      >
        <Shield
          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}
          strokeWidth={1.5}
        />
        <p className={`text-[10px] leading-relaxed ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
          For decision support only — not final investment advice. Rationale is AI-generated
          and validated against deal evidence. All scoring, conviction, and verdict outputs
          are determined by the deterministic pipeline.
          {rationale.created_at && (
            <> Generated {new Date(rationale.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.</>
          )}
        </p>
      </div>
    </section>
  );
}
