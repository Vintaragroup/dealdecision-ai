// Phase B scoring contracts (types only). No runtime logic lives here.

export type PhaseBFeaturesV1 = {
  schema_version: 1;
  computed_at: string; // ISO timestamp
  deal_id: string;

  coverage: {
    documents_count: number;
    segments_count: number;
    visuals_count: number;
    evidence_count: number;
    evidence_per_visual: number;
  };

  content_density: {
    avg_ocr_chars_per_visual: number;
    pct_visuals_with_ocr: number; // 0..1
    pct_visuals_with_structured: number; // 0..1
  };

  structure: {
    pct_segments_with_visuals: number; // 0..1
    pct_documents_with_segments: number; // 0..1
    pct_documents_with_visuals: number; // 0..1
  };

  flags: {
    no_visuals: boolean;
    low_evidence: boolean;
    low_coverage: boolean;
  };

  notes?: string[];
};

export type PhaseBScoreBreakdown = {
  // All components use the same 0-100 scale for consistency with deal-level scores.
  market: number;
  traction: number;
  product: number;
  team: number;
  financials: number;
  risks: number;
  docs: number;
  evidence: number;
};

export type PhaseBPenalty = {
  code: string; // Stable identifier (e.g., "missing_financials")
  label: string; // Human-readable description
  amount: number; // Deduction on 0-100 scale (negative values supported if bonuses are needed)
  meta?: Record<string, unknown>;
};

export type PhaseBProvenanceItem = {
  segment_key?: string; // Stable key used for aggregation (e.g., doc_id or segment_id)
  segment_label?: string;
  document_id?: string;
  visual_count?: number;
  evidence_count?: number;
  avg_confidence?: number | null; // 0-1 normalized if present
  notes?: string;
};

export type PhaseBScoreResult = {
  version: string; // Schema or algorithm version, e.g., "1.0.0"
  score_0_100: number;
  recommendation: "GO" | "CONSIDER" | "PASS" | string; // Allow custom labels without widening everywhere
  confidence_0_1: number; // 0-1 normalized confidence
  breakdown: PhaseBScoreBreakdown;
  penalties: PhaseBPenalty[];
  provenance: PhaseBProvenanceItem[];
};

export type PhaseBFeatureSegment = {
  segment_key: string; // e.g., document_id or visual_group key
  segment_label?: string;
  document_ids: string[];
  visual_count: number;
  evidence_count: number;
  avg_confidence?: number | null; // 0-1 normalized if available
  signals?: Record<string, number | string | boolean | null>; // Optional derived metrics per segment
};

export type PhaseBFeatures = {
  total_documents: number;
  total_visuals: number;
  total_evidence: number;
  avg_doc_confidence?: number | null; // 0-1 normalized if available
  segments: PhaseBFeatureSegment[];
  // Additional deterministic aggregates keyed by metric name.
  aggregates?: Record<string, number>;
};
