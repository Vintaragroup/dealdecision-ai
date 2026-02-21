import React, { useMemo } from 'react';
import type { FinancialCoverageEvidenceRefV1, FinancialCoverageProfileV1Like } from '../../lib/selectors/selectAuthoritativeFinancialCoverageV1';

export type FinancialCoveragePanelProps = {
  darkMode: boolean;
  financialCoverage: FinancialCoverageProfileV1Like | null;
  documentTitles: Record<string, string>;
  burnHasNumeric?: boolean;
  runwayHasNumeric?: boolean;
};

const asBool = (v: unknown): boolean => v === true;

const confidenceToNumeric = (c: unknown): number | null => {
  if (c === 'high') return 0.9;
  if (c === 'medium') return 0.66;
  if (c === 'low') return 0.33;
  return null;
};

const confidenceToLabel = (c: unknown): 'High' | 'Med' | 'Low' | '—' => {
  if (c === 'high') return 'High';
  if (c === 'medium') return 'Med';
  if (c === 'low') return 'Low';
  return '—';
};

const yn = (v: boolean): string => (v ? 'Yes' : 'No');

const presentNoValueLabel = (present: boolean, hasNumeric: boolean | undefined): string => {
  if (!present) return 'No';
  if (hasNumeric === false) return 'Present (no value)';
  return 'Yes';
};

const normalizeEvidenceList = (evidence: unknown): Array<{ key: string; ref: FinancialCoverageEvidenceRefV1 }> => {
  if (!evidence || typeof evidence !== 'object') return [];
  const out: Array<{ key: string; ref: FinancialCoverageEvidenceRefV1 }> = [];
  for (const [key, raw] of Object.entries(evidence as Record<string, any>)) {
    if (!raw || typeof raw !== 'object') continue;
    out.push({ key, ref: raw as FinancialCoverageEvidenceRefV1 });
  }
  return out;
};

const formatDocLabel = (ref: FinancialCoverageEvidenceRefV1, documentTitles: Record<string, string>): string => {
  const docId = typeof ref.document_id === 'string' ? ref.document_id : '';
  const title = docId ? (documentTitles[docId] || docId) : 'Document';
  const pageIndex = typeof ref.page_index === 'number' && Number.isFinite(ref.page_index) ? Math.max(0, Math.floor(ref.page_index)) : null;
  const page = pageIndex != null ? `p${pageIndex + 1}` : (typeof ref.page === 'number' && Number.isFinite(ref.page) ? `p${Math.max(1, Math.floor(ref.page))}` : 'p—');
  return `${title} · ${page}`;
};

export function FinancialCoveragePanel({ darkMode, financialCoverage, documentTitles, burnHasNumeric, runwayHasNumeric }: FinancialCoveragePanelProps) {
  const cardClass = `backdrop-blur-xl border rounded-xl p-6 w-full ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`;
  const labelClass = darkMode ? 'text-gray-300' : 'text-gray-700';
  const valueClass = darkMode ? 'text-white' : 'text-gray-900';
  const mutedClass = darkMode ? 'text-gray-400' : 'text-gray-600';

  const view = useMemo(() => {
    const cov = financialCoverage?.coverage ?? {};

    const historical = asBool((cov as any).historical_revenue_present);
    const forecast = asBool((cov as any).forecast_revenue_present);
    const income = asBool((cov as any).income_statement_present);
    const balance = asBool((cov as any).balance_sheet_present);
    const cashFlow = asBool((cov as any).cash_flow_present);

    const incomeTri: 'Yes' | 'No' | 'Partial' = income ? 'Yes' : (balance || cashFlow ? 'Partial' : 'No');

    const burn = asBool((cov as any).burn_rate_present);
    const runway = asBool((cov as any).runway_present);
    const unitEcon = asBool((cov as any).unit_economics_present);

    const sources = Array.isArray(financialCoverage?.sources) ? financialCoverage!.sources! : [];
    const xlsxPresent = sources.some((s: any) => s?.kind === 'xlsx') || (Array.isArray(financialCoverage?.notes) ? financialCoverage!.notes!.includes('xlsx_present') : false);
    const xlsxEvidenceUsed = Array.isArray(financialCoverage?.notes) ? financialCoverage!.notes!.includes('xlsx_evidence_used') : false;

    const confidenceRaw = (financialCoverage as any)?.confidence;
    const confidence0_1 = confidenceToNumeric(confidenceRaw);
    const confidenceLabel = confidenceToLabel(confidenceRaw);

    const evidenceItems = normalizeEvidenceList(financialCoverage?.evidence);

    return {
      historical,
      forecast,
      incomeTri,
      burn,
      runway,
      unitEcon,
      xlsxPresent,
      xlsxEvidenceUsed,
      confidence0_1,
      confidenceLabel,
      evidenceItems,
    };
  }, [financialCoverage]);

  return (
    <section aria-label="Financial coverage" className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-xs uppercase tracking-wider ${mutedClass}`}>Financial Coverage</div>
          <div className={`mt-1 text-sm ${mutedClass}`}>Deterministic document coverage for financial metrics.</div>
        </div>
        <div className={`text-right text-xs ${mutedClass}`}>
          <div>
            Confidence: <span className={valueClass}>{view.confidenceLabel}</span>
            {typeof view.confidence0_1 === 'number' ? <span className={mutedClass}>{` (${view.confidence0_1.toFixed(2)})`}</span> : null}
          </div>
          <div>
            XLSX present: <span className={valueClass}>{yn(view.xlsxPresent)}</span>
            {view.xlsxPresent ? <span className={mutedClass}>{` · evidence used: ${yn(view.xlsxEvidenceUsed)}`}</span> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center justify-between">
          <div className={`text-sm ${labelClass}`}>Historical revenue present</div>
          <div className={`text-sm font-semibold ${valueClass}`}>{yn(view.historical)}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className={`text-sm ${labelClass}`}>Forecast present</div>
          <div className={`text-sm font-semibold ${valueClass}`}>{yn(view.forecast)}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className={`text-sm ${labelClass}`}>Income statement present</div>
          <div className={`text-sm font-semibold ${valueClass}`}>{view.incomeTri}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className={`text-sm ${labelClass}`}>Burn present</div>
          <div className={`text-sm font-semibold ${valueClass}`}>{presentNoValueLabel(view.burn, burnHasNumeric)}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className={`text-sm ${labelClass}`}>Runway present</div>
          <div className={`text-sm font-semibold ${valueClass}`}>{presentNoValueLabel(view.runway, runwayHasNumeric)}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className={`text-sm ${labelClass}`}>Unit economics present</div>
          <div className={`text-sm font-semibold ${valueClass}`}>{yn(view.unitEcon)}</div>
        </div>
      </div>

      {view.evidenceItems.length > 0 ? (
        <div className="mt-5">
          <div className={`text-xs uppercase tracking-wider ${mutedClass}`}>Sources</div>
          <ul className="mt-2 space-y-2">
            {view.evidenceItems.slice(0, 12).map((it) => {
              const header = formatDocLabel(it.ref, documentTitles);
              const snippet = typeof it.ref.snippet === 'string' ? it.ref.snippet : '';
              const keyLabel = it.key.replace(/_/g, ' ');
              return (
                <li key={`${it.key}-${header}-${snippet.slice(0, 20)}`} className="text-xs">
                  <div className={valueClass}>
                    {header} <span className={mutedClass}>{`· ${keyLabel}`}</span>
                  </div>
                  {snippet ? <div className={`mt-0.5 whitespace-pre-wrap ${mutedClass}`}>{snippet}</div> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className={`mt-5 text-xs ${mutedClass}`}>No coverage evidence refs available.</div>
      )}
    </section>
  );
}
