export type PhaseBSeverity = "low" | "med" | "high";

export type PhaseBFinding = {
  code: string;
  title: string;
  severity: PhaseBSeverity;
  detail?: string;
};

export type PhaseBAction = {
  code: string;
  title: string;
  why: string;
  steps: string[];
};

export type PhaseBBadges = string[];

type PhaseBFeaturesV1 = {
  coverage?: {
    documents_count?: number | null;
    segments_count?: number | null;
    visuals_count?: number | null;
    evidence_count?: number | null;
    evidence_per_visual?: number | null;
  } | null;
  content_density?: {
    avg_ocr_chars_per_visual?: number | null;
    pct_visuals_with_ocr?: number | null;
    pct_visuals_with_structured?: number | null;
  } | null;
  structure?: {
    pct_segments_with_visuals?: number | null;
    pct_documents_with_segments?: number | null;
    pct_documents_with_visuals?: number | null;
  } | null;
  flags?: {
    no_visuals?: boolean;
    low_evidence?: boolean;
    low_coverage?: boolean;
  } | null;
};

type DerivedInput = {
  latest: PhaseBFeaturesV1 | null | undefined;
  prior?: PhaseBFeaturesV1 | null | undefined;
};

const severityOrder: PhaseBSeverity[] = ["low", "med", "high"];

const clampRatio = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : null;
  if (num === null || Number.isNaN(num)) return null;
  const clamped = Math.min(1, Math.max(0, num));
  return Number.isFinite(clamped) ? clamped : null;
};

const toNumber = (value: unknown): number | null => {
  const num = typeof value === "number" && Number.isFinite(value) ? value : null;
  return num === null ? null : num;
};

const bumpSeverity = (base: PhaseBSeverity, shouldBump: boolean): PhaseBSeverity => {
  if (!shouldBump) return base;
  const idx = severityOrder.indexOf(base);
  if (idx === -1) return base;
  return severityOrder[Math.min(severityOrder.length - 1, idx + 1)];
};

const detectDrop = (current: number | null, previous: number | null, opts?: { isPercent?: boolean }): { dropped: boolean; note?: string } => {
  if (current === null || previous === null) return { dropped: false };
  const delta = previous - current;
  if (delta <= 0) return { dropped: false };
  const relative = previous !== 0 ? delta / previous : 0;
  const absoluteThreshold = opts?.isPercent ? 0.2 : 0;
  const dropped = relative >= 0.2 || (opts?.isPercent && delta >= absoluteThreshold);
  if (!dropped) return { dropped: false };
  const pct = opts?.isPercent ? Math.round(relative * 100) : Number(relative.toFixed(2));
  const note = `Drop vs prior: ${current} (prev ${previous}, ${pct}${opts?.isPercent ? "%" : ""} down)`;
  return { dropped: true, note };
};

export function derivePhaseBInsights(input: DerivedInput): {
  findings: PhaseBFinding[];
  actions: PhaseBAction[];
  badges: PhaseBBadges;
} {
  const latest = input.latest;
  if (!latest || typeof latest !== "object") {
    return { findings: [], actions: [], badges: [] };
  }

  const coverage = latest.coverage ?? {};
  const contentDensity = latest.content_density ?? {};
  const structure = latest.structure ?? {};
  const flags = latest.flags ?? {};

  const priorCoverage = input.prior?.coverage ?? {};
  const priorContentDensity = input.prior?.content_density ?? {};
  const priorStructure = input.prior?.structure ?? {};

  const visualsCount = toNumber(coverage.visuals_count);
  const evidenceCount = toNumber(coverage.evidence_count);
  const evidencePerVisual = toNumber(coverage.evidence_per_visual);
  const pctVisualsWithOcr = clampRatio(contentDensity.pct_visuals_with_ocr);
  const pctVisualsWithStructured = clampRatio(contentDensity.pct_visuals_with_structured);
  const pctSegmentsWithVisuals = clampRatio(structure.pct_segments_with_visuals);

  const priorEvidencePerVisual = toNumber(priorCoverage.evidence_per_visual);
  const priorPctVisualsWithOcr = clampRatio(priorContentDensity.pct_visuals_with_ocr);
  const priorPctVisualsWithStructured = clampRatio(priorContentDensity.pct_visuals_with_structured);
  const priorPctSegmentsWithVisuals = clampRatio(priorStructure.pct_segments_with_visuals);

  const findings: PhaseBFinding[] = [];
  const actions: PhaseBAction[] = [];
  const badges: string[] = [];

  const addFinding = (
    code: string,
    title: string,
    baseSeverity: PhaseBSeverity,
    detail?: string
  ) => {
    findings.push({ code, title, severity: baseSeverity, detail });
    return findings[findings.length - 1];
  };

  const addAction = (code: string, title: string, why: string, steps: string[]) => {
    actions.push({ code, title, why, steps });
  };

  const noVisualsFlagged = Boolean(flags.no_visuals) && (visualsCount ?? 0) === 0;
  if (noVisualsFlagged) {
    addFinding("phaseb_no_visuals", "No visuals linked to deal via documents", "high");
    addAction(
      "phaseb_action_no_visuals",
      "Run visual extraction / verify supported file types",
      "Phase B found no visuals to analyze",
      ["Rerun Phase B with visual extraction enabled", "Verify source files are supported (PDF/images)"]
    );
    badges.push("Phase B: No visuals");
  }

  if ((visualsCount ?? 0) > 0 && evidenceCount === 0) {
    addFinding("phaseb_no_evidence", "No evidence linked", "high", "Visuals present but evidence count is zero");
    addAction(
      "phaseb_action_no_evidence",
      "Generate evidence snippets for visuals",
      "Visuals lack linked evidence",
      ["Re-run evidence extraction for visuals", "Confirm evidence linking step is enabled"]
    );
    badges.push("Phase B: No evidence");
  }

  if (evidencePerVisual !== null && evidencePerVisual < 0.5) {
    const drop = detectDrop(evidencePerVisual, priorEvidencePerVisual, { isPercent: false });
    const severity = bumpSeverity("med", drop.dropped);
    const detail = drop.dropped ? drop.note : undefined;
    addFinding("phaseb_low_evidence_density", "Low evidence density", severity, detail);
    addAction(
      "phaseb_action_low_evidence_density",
      "Increase evidence extraction depth",
      "Evidence per visual is below target",
      ["Expand snippet extraction for visuals", "Review visual-to-evidence mapping rules"]
    );
    badges.push("Phase B: Low evidence density");
  }

  if (pctVisualsWithOcr !== null && pctVisualsWithOcr < 0.5) {
    const drop = detectDrop(pctVisualsWithOcr, priorPctVisualsWithOcr, { isPercent: true });
    const severity = bumpSeverity("med", drop.dropped);
    const detail = drop.dropped ? drop.note : undefined;
    addFinding("phaseb_low_ocr", "Low OCR coverage", severity, detail);
    addAction(
      "phaseb_action_low_ocr",
      "Enable OCR for images/scan pages",
      "Few visuals contain OCR text",
      ["Ensure OCR step runs for image-heavy slides", "Re-run Phase B with OCR enabled"]
    );
    badges.push("Phase B: Low OCR");
  }

  if (pctVisualsWithStructured !== null && pctVisualsWithStructured < 0.25) {
    const drop = detectDrop(pctVisualsWithStructured, priorPctVisualsWithStructured, { isPercent: true });
    const severity = bumpSeverity("low", drop.dropped);
    const detail = drop.dropped ? drop.note : undefined;
    addFinding("phaseb_low_structured", "Low structured detection", severity, detail);
    addAction(
      "phaseb_action_low_structured",
      "Enable table/chart parsing",
      "Structured detections are scarce",
      ["Enable table/chart parsing in extraction", "Check sample pages for tabular data"]
    );
    badges.push("Phase B: Low structured");
  }

  if (pctSegmentsWithVisuals !== null && pctSegmentsWithVisuals < 0.4) {
    const drop = detectDrop(pctSegmentsWithVisuals, priorPctSegmentsWithVisuals, { isPercent: true });
    const severity = bumpSeverity("med", drop.dropped);
    const detail = drop.dropped ? drop.note : undefined;
    addFinding("phaseb_segments_lack_visuals", "Segments lack visuals", severity, detail);
    addAction(
      "phaseb_action_segments_lack_visuals",
      "Improve segment↔visual attachment mapping",
      "Segments are missing attached visuals",
      ["Re-run attachment linking for visuals", "Review segment detection for key sections"]
    );
    badges.push("Phase B: Weak segment visuals");
  }

  return {
    findings,
    actions,
    badges,
  };
}
