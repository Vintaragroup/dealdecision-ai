/**
 * Stage5IntelPanel — Internal debug section for Stage 5 intelligence output.
 *
 * INTERNAL ONLY. Rendered inside WorkspaceDebugPanel, gated behind
 * `workspaceDebugEnabled`. Never exposed to end users.
 *
 * Reviewer note: Memory influence is a secondary signal. It does not change
 * ORS or overwrite verdicts.
 */

import { useState, useEffect } from 'react';
import { apiGetIntelligenceDebug, type IntelligenceDebugPayload } from '../../lib/apiClient';

interface Stage5IntelPanelProps {
  dealId: string;
  darkMode: boolean;
}

// ─── Label helpers ────────────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, fallback = '—'): string {
  if (v == null) return fallback;
  return String(v);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v)}%`;
}

function fmtBool(v: boolean | null | undefined): string {
  if (v == null) return '—';
  return v ? 'Yes' : 'No';
}

function signBadge(adj: number | null): { label: string; color: string } {
  if (adj == null) return { label: '—', color: 'text-gray-400' };
  if (adj > 0) return { label: `+${adj}`, color: 'text-emerald-500' };
  if (adj < 0) return { label: String(adj), color: 'text-red-400' };
  return { label: '0', color: 'text-gray-400' };
}

function bandColor(band: string | null, darkMode: boolean): string {
  if (!band) return darkMode ? 'text-gray-400' : 'text-gray-500';
  const b = band.toLowerCase();
  if (b === 'high') return 'text-emerald-500';
  if (b === 'medium') return darkMode ? 'text-amber-300' : 'text-amber-600';
  if (b === 'low') return 'text-red-400';
  return darkMode ? 'text-gray-300' : 'text-gray-700';
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  valueClass,
  darkMode,
  multiline = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  darkMode: boolean;
  multiline?: boolean;
}) {
  return (
    <div className={`flex ${multiline ? 'flex-col gap-0.5' : 'items-baseline justify-between gap-2'}`}>
      <span className={`shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
      {multiline ? (
        <span className={`text-xs leading-relaxed break-words ${valueClass ?? (darkMode ? 'text-gray-200' : 'text-gray-800')}`}>
          {value}
        </span>
      ) : (
        <span className={`font-medium truncate ${valueClass ?? (darkMode ? 'text-gray-200' : 'text-gray-800')}`}>
          {value}
        </span>
      )}
    </div>
  );
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function SubSection({
  title,
  darkMode,
  children,
}: {
  title: string;
  darkMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className={`text-[10px] font-semibold uppercase tracking-widest ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Stage5IntelPanel({ dealId, darkMode }: Stage5IntelPanelProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [data, setData] = useState<IntelligenceDebugPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lazy fetch — only fires when the <details> are opened
  const load = () => {
    if (status !== 'idle') return;
    setStatus('loading');
    apiGetIntelligenceDebug(dealId)
      .then((d) => { setData(d); setStatus('ready'); })
      .catch((e) => { setErrorMsg(e instanceof Error ? e.message : String(e)); setStatus('error'); });
  };

  const c = data?.confidence ?? null;
  const ch = data?.challenge ?? null;
  const mem = data?.memory ?? null;

  const adjBadge = signBadge(typeof c?.memory_adjustment === 'number' ? c.memory_adjustment : null);
  const totalFlags = (ch?.flag_count_critical ?? 0) + (ch?.flag_count_error ?? 0) + (ch?.flag_count_warn ?? 0);

  const memSignalLabel = (() => {
    if (!mem) return '—';
    if (mem.memory_fragility_signal) return 'Fragility ⚠';
    if (mem.memory_support_signal) return 'Support ✓';
    return 'None';
  })();
  const memSignalClass = (() => {
    if (!mem) return '';
    if (mem.memory_fragility_signal) return 'text-red-400';
    if (mem.memory_support_signal) return 'text-emerald-500';
    return darkMode ? 'text-gray-400' : 'text-gray-500';
  })();

  return (
    <details
      className={`backdrop-blur-xl border rounded-2xl overflow-hidden ${
        darkMode
          ? 'bg-gradient-to-br from-[#18181b]/80 to-[#27272a]/80 border-white/5'
          : 'bg-gradient-to-br from-white/80 to-gray-50/80 border-gray-200/50'
      }`}
      onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) load(); }}
    >
      <summary className={`px-4 py-3 cursor-pointer select-none text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
        Debug → Stage 5 Intelligence{' '}
        {status === 'loading' && (
          <span className={`text-[10px] ml-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>loading…</span>
        )}
        {status === 'ready' && c?.overall_confidence_band && (
          <span className={`text-[10px] ml-1 font-normal ${bandColor(c.overall_confidence_band, darkMode)}`}>
            {c.overall_confidence_band} confidence
          </span>
        )}
      </summary>

      <div className={`px-4 pb-4 text-xs space-y-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>

        {/* Reviewer note */}
        <div className={`text-[10px] italic border-l-2 pl-2 ${darkMode ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
          Memory influence is a secondary signal. It does not change ORS or overwrite verdicts.
        </div>

        {status === 'error' && (
          <div className="text-red-400">{errorMsg ?? 'Failed to load intelligence data.'}</div>
        )}

        {status === 'loading' && (
          <div className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Loading…</div>
        )}

        {status === 'idle' && (
          <div className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Open to load.</div>
        )}

        {status === 'ready' && !data?.confidence && (
          <div className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            No Stage 5 run found for this deal.
            {!data?._meta?.has_confidence_table && ' (deal_confidence_assessments table not found)'}
          </div>
        )}

        {status === 'ready' && c && (
          <>
            {/* Run header */}
            <div className={`font-mono text-[9px] ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
              run {data?.run_id ?? '—'}
            </div>

            {/* Confidence section */}
            <SubSection title="Confidence" darkMode={darkMode}>
              <Row
                label="Score"
                value={c.overall_confidence_score != null ? String(c.overall_confidence_score) : '—'}
                darkMode={darkMode}
              />
              <Row
                label="Band"
                value={c.overall_confidence_band ?? '—'}
                valueClass={bandColor(c.overall_confidence_band ?? null, darkMode)}
                darkMode={darkMode}
              />
              <Row
                label="Memory adjustment"
                value={adjBadge.label}
                valueClass={adjBadge.color}
                darkMode={darkMode}
              />
              {c.memory_adjustment_reason && (
                <Row
                  label="Reason"
                  value={c.memory_adjustment_reason}
                  darkMode={darkMode}
                  multiline
                />
              )}
              {(c.penalty_count != null || c.total_penalty != null) && (
                <Row
                  label="Penalties"
                  value={`${fmtNum(c.penalty_count)} factors, −${fmtNum(c.total_penalty)} pts`}
                  darkMode={darkMode}
                />
              )}
            </SubSection>

            {/* Memory section */}
            <SubSection title="Memory" darkMode={darkMode}>
              <Row label="Similar deals" value={fmtNum(mem?.similar_deal_count ?? null)} darkMode={darkMode} />
              <Row label="Avg similarity" value={fmtPct(mem?.avg_similarity_pct ?? null)} darkMode={darkMode} />
              <Row
                label="Signal"
                value={memSignalLabel}
                valueClass={memSignalClass}
                darkMode={darkMode}
              />
              {mem?.verdict_agreement_fraction != null && (
                <Row
                  label="Agreement"
                  value={fmtPct((mem.verdict_agreement_fraction as number) * 100)}
                  darkMode={darkMode}
                />
              )}
            </SubSection>

            {/* Challenge section */}
            {ch ? (
              <SubSection title="Challenge Pass" darkMode={darkMode}>
                <Row label="Verdict resistance" value={`${fmtNum(ch.verdict_resistance_score)} — ${ch.verdict_resistance_label ?? '—'}`} darkMode={darkMode} />
                <Row
                  label="Flags"
                  value={`${totalFlags} total (${fmtNum(ch.flag_count_critical)} critical / ${fmtNum(ch.flag_count_error)} error / ${fmtNum(ch.flag_count_warn)} warn)`}
                  darkMode={darkMode}
                />
                <Row label="Missing evidence items" value={fmtNum(ch.missing_evidence_count)} darkMode={darkMode} />
                <Row label="Diligence gaps" value={fmtNum(ch.diligence_gaps_count)} darkMode={darkMode} />
                <Row
                  label="Memory challenge used"
                  value={fmtBool(ch.memory_challenge_used)}
                  valueClass={
                    ch.memory_challenge_used
                      ? 'text-amber-400'
                      : (darkMode ? 'text-gray-400' : 'text-gray-500')
                  }
                  darkMode={darkMode}
                />
                {ch.memory_challenge_used && ch.memory_challenge_summary && (
                  <Row
                    label="Memory challenge summary"
                    value={ch.memory_challenge_summary}
                    darkMode={darkMode}
                    multiline
                  />
                )}
                {!ch.memory_challenge_used && (
                  <div className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    No memory challenge context applied to challenge pass.
                  </div>
                )}
              </SubSection>
            ) : (
              <SubSection title="Challenge Pass" darkMode={darkMode}>
                <div className={`${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>No challenge pass result found for this run.</div>
              </SubSection>
            )}
          </>
        )}
      </div>
    </details>
  );
}
