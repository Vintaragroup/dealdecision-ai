import {
  apiGetDealGovernedOverlayPersisted,
  apiGetDealReportNarrated,
  type PersistedGovernedOverlayOverview,
} from './apiClient';

export type PreferredOverlaySource = 'persisted' | 'narrated' | 'none';

export type PreferredOverlayResult =
  | {
      overlay_source: 'persisted';
      overlay: PersistedGovernedOverlayOverview;
    }
  | {
      overlay_source: 'narrated';
      overlay: {
        envelope: any;
        llm_overview_v1: any | null;
        llm_narration_v1: any | null;
        metadata: any | null;
      };
    }
  | {
      overlay_source: 'none';
      overlay: null;
    };

function getReportObjFromAny(envelopeOrReport: any): any | null {
  if (!envelopeOrReport || typeof envelopeOrReport !== 'object') return null;
  // If envelope is { ready, report }, prefer report.
  if (envelopeOrReport.report && typeof envelopeOrReport.report === 'object') return envelopeOrReport.report;
  return envelopeOrReport;
}

export async function fetchPreferredDealOverlay(dealId: string): Promise<PreferredOverlayResult> {
  const id = String(dealId || '').trim();
  if (!id) return { overlay_source: 'none', overlay: null };

  // 1) Persisted overlay first
  try {
    const persisted = await apiGetDealGovernedOverlayPersisted(id);
    if (persisted && persisted.overview) {
      return { overlay_source: 'persisted', overlay: persisted.overview };
    }
    // 2) If 200 + overview null => optional fallback to narrated
  } catch {
    // 3) If persisted fails (404/501/etc) => fallback to narrated
  }

  // 4) Narrated fallback (legacy)
  try {
    const env = await apiGetDealReportNarrated(id);
    const ready = Boolean((env as any)?.ready);
    if (!ready) return { overlay_source: 'none', overlay: null };

    const report = getReportObjFromAny(env);
    const llm_overview_v1 = report && typeof report === 'object' ? ((report as any).llm_overview_v1 ?? null) : null;
    const llm_narration_v1 = report && typeof report === 'object' ? ((report as any).llm_narration_v1 ?? null) : null;
    const metadata = report && typeof report === 'object' ? ((report as any).metadata ?? null) : null;

    const hasAny = !!(llm_overview_v1 || llm_narration_v1);
    if (!hasAny) return { overlay_source: 'none', overlay: null };

    return {
      overlay_source: 'narrated',
      overlay: { envelope: env as any, llm_overview_v1, llm_narration_v1, metadata },
    };
  } catch {
    // Never block page render on overlay failure.
    return { overlay_source: 'none', overlay: null };
  }
}
