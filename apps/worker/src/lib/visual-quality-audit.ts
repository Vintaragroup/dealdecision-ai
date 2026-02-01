export type VisualQualityAuditV1 = {
  schema_version: "visual_quality_audit_v1";
  deal_id: string;
  computed_at: string;
  totals: {
    visuals: number;
    evidence_first_empty: number;
    evidence_first_known_garbage: number;
    evidence_first_low_signal_non_empty: number;
    evidence_first_signal_mean: number;
  };
  thresholds: {
    low_signal_threshold: number;
  };
  pass: boolean;
  failing_reasons: string[];
};

function cleanOneLine(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weirdCharRatio(s: string): number {
  if (!s) return 1;
  const weird = (s.match(/[^a-zA-Z0-9\s\-\/:,.()&+%$]/g) ?? []).length;
  return weird / Math.max(1, s.length);
}

function alphaRatio(s: string): number {
  const noSpace = s.replace(/\s/g, "");
  if (!noSpace) return 0;
  const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
  return letters / Math.max(1, noSpace.length);
}

function snippetSignalScore(snippet: string): number {
  const s = cleanOneLine(snippet);
  if (!s) return 0;
  const hasUrl = /\bhttps?:\/\//i.test(s) || /\bwww\./i.test(s);
  const hasEmail = /\b\S+@\S+\b/.test(s);
  const wc = s.split(/\s+/).filter(Boolean).length;
  const alpha = alphaRatio(s);
  const weird = weirdCharRatio(s);

  let score = 0;
  score += Math.min(1, wc / 20) * 0.45;
  score += clamp01((alpha - 0.45) / 0.5) * 0.45;
  score -= clamp01((weird - 0.08) / 0.25) * 0.35;
  if (hasUrl || hasEmail) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

export function containsKnownGarbage(snippet: string): boolean {
  const s = cleanOneLine(snippet);
  if (!s) return false;
  if (/\bposop\b/i.test(s)) return true;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.some((w) => /^[A-Z][a-z][A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")))) return true;
  if (tokens.length >= 7 && tokens.filter((w) => w.length <= 2).length >= Math.ceil(tokens.length * 0.7)) return true;
  return false;
}

export async function computeVisualQualityAuditForDeal(pool: { query: Function }, dealId: string): Promise<VisualQualityAuditV1> {
  const dealIdClean = cleanOneLine(dealId);
  const lowSignalThreshold = 0.45;

  const { rows } = await pool.query(
    `SELECT va.id AS visual_asset_id,
            (
              SELECT el.snippet
                FROM evidence_links el
               WHERE el.visual_asset_id = va.id
                 AND el.snippet IS NOT NULL
                 AND el.snippet <> ''
               ORDER BY el.created_at DESC
               LIMIT 1
            ) AS snippet
       FROM visual_assets va
       JOIN documents d ON d.id = va.document_id
      WHERE d.deal_id = $1`,
    [dealIdClean]
  );

  const snippets: string[] = (rows ?? []).map((r: any) => (typeof r?.snippet === "string" ? r.snippet : ""));
  const visuals = snippets.length;

  const scores = snippets.map((s) => snippetSignalScore(s));
  const evidenceFirstEmpty = snippets.filter((s) => !cleanOneLine(s)).length;
  const evidenceFirstKnownGarbage = snippets.filter((s) => containsKnownGarbage(s)).length;
  const evidenceFirstLowSignalNonEmpty = snippets.filter((s, idx) => {
    const t = cleanOneLine(s);
    if (!t) return false;
    return scores[idx] < lowSignalThreshold;
  }).length;

  const failing: string[] = [];
  if (evidenceFirstKnownGarbage > 0) failing.push("known_garbage_first_snippet");
  // Note: empties are expected sometimes (spreadsheets/images). We do not fail on empties here.
  if (visuals > 0 && evidenceFirstLowSignalNonEmpty / visuals > 0.05) failing.push("too_many_low_signal_non_empty");

  return {
    schema_version: "visual_quality_audit_v1",
    deal_id: dealIdClean,
    computed_at: new Date().toISOString(),
    totals: {
      visuals,
      evidence_first_empty: evidenceFirstEmpty,
      evidence_first_known_garbage: evidenceFirstKnownGarbage,
      evidence_first_low_signal_non_empty: evidenceFirstLowSignalNonEmpty,
      evidence_first_signal_mean: mean(scores),
    },
    thresholds: {
      low_signal_threshold: lowSignalThreshold,
    },
    pass: failing.length === 0,
    failing_reasons: failing,
  };
}
