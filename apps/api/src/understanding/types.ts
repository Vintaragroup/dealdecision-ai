export type UnderstandingVersion = "deterministic_understanding_v1";

export type NodeId = string;

export interface UnderstandingArtifactMeta {
  analysis_version: UnderstandingVersion;
  created_at: string;
  input_hash: string;
  prompt_version?: string;
}

export interface SourceSpan {
  start: number;
  end: number;
}

export interface EvidenceSnippet {
  snippet: string;
  score: number;
  features?: string[];
  source_span?: SourceSpan;
}

export type MetricUnit = "USD" | "PERCENT" | "COUNT" | "MONTHS" | "YEARS" | "DATE" | "TEXT";

export interface ExtractedMetric {
  metric_type: string;
  value_normalized: number | string;
  raw_value: string;
  unit: MetricUnit;
  context: string;
  confidence: number;
  source_span?: SourceSpan;
}

export interface ExtractedEntity {
  entity_type: "ORG" | "PERSON" | "GPE" | "PRODUCT" | "OTHER";
  text: string;
  confidence: number;
  source_span?: SourceSpan;
}

export type PageType =
  | "financials_pnl"
  | "financials_cashflow"
  | "financials_balance_sheet"
  | "financials_summary"
  | "terms_cap_table"
  | "terms_investment"
  | "market_competition"
  | "market_size"
  | "product_overview"
  | "product_screenshots"
  | "traction_kpis"
  | "timeline_roadmap"
  | "team"
  | "legal_disclosures"
  | "unknown";

export interface PageUnderstanding {
  page_id: NodeId;
  document_id: NodeId;
  page_index?: number;
  page_label?: string;

  normalized_text_ref?: string;
  /** Optional: inline normalized text (v1 test/debug convenience). */
  normalized_text?: string;
  /** Optional: normalization flags from normalizeText (v1 test/debug convenience). */
  normalization_flags?: string[];
  page_type: PageType;
  confidence: number;
  why: string[];

  evidence: EvidenceSnippet[];
  key_numbers: ExtractedMetric[];
  key_entities: ExtractedEntity[];

  quality_flags: string[];
}

export interface DocumentUnderstanding {
  document_id: NodeId;
  document_title?: string;

  /** Optional deterministic rollups for debug/UI (no new inference). */
  document_summary?: {
    top_page_types: Array<{ page_type: PageType; count: number }>;
    totals: { currency_count: number; percent_count: number; year_count: number };
    common_metric_types: Array<{ metric_type: string; count: number }>;
  };
  /** Optional: top evidence snippets across pages (scored + traceable). */
  document_key_points?: EvidenceSnippet[];

  key_points: string[];
  key_numbers: ExtractedMetric[];
  outline: Array<{
    label: string;
    page_ids: NodeId[];
  }>;
}

export interface SuggestedMove {
  page_id: NodeId;
  from_segment_id: NodeId;
  to_segment_id: NodeId;
  score: number;
  rationale: string[];
}

export interface SegmentUnderstanding {
  segment_id: NodeId;
  segment_label?: string;

  /** Optional deterministic rollups for debug/UI (no new inference). */
  segment_summary?: {
    dominant_page_types: Array<{ page_type: PageType; count: number }>;
    common_metric_types: Array<{ metric_type: string; count: number }>;
  };

  key_points: string[];
  key_numbers: ExtractedMetric[];
  evidence: EvidenceSnippet[];
  suggested_moves?: SuggestedMove[];
}

export interface UnderstandingPatch extends UnderstandingArtifactMeta {
  deal_id: NodeId;

  pages: Record<NodeId, PageUnderstanding>;
  documents: Record<NodeId, DocumentUnderstanding>;
  segments?: Record<NodeId, SegmentUnderstanding>;
}

/**
 * Minimal input shape used by deterministic understanding in tests and local runs.
 * This is intentionally permissive to match fixture payloads.
 */
export interface DeterministicUnderstandingInput {
  deal_id: NodeId;
  documents: Array<{
    document_id: NodeId;
    title?: string;
    page_count?: number;
    type?: string;
  }>;
  pages: Array<{
    page_id: NodeId;
    document_id: NodeId;
    page_index?: number;
    page_number?: number;
    raw_ocr_text?: string;
    structured_extraction?: unknown;
    evidence?: unknown;
  }>;
  segments?: Array<{
    segment_id: NodeId;
    label?: string;
    page_ids: NodeId[];
  }>;
}
