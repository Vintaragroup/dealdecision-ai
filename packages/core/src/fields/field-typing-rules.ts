/**
 * Field typing rules / outputs live in Core and must remain transport-agnostic.
 *
 * NOTE: Do not import DB/API evidence row types here. We use a lightweight
 * evidence reference shape that can be produced from DPU/promoted facts and
 * consumed by report/UI layers.
 */

export type EvidenceRef = {
  source_document_id: string;
  /** 0-based page index, when known */
  page_index: number | null;
  /** Optional human-friendly slide title */
  slide_title?: string | null;
  /** Optional snippet used for debugging/verification */
  snippet?: string | null;
  /** Optional evidence id when the upstream layer has one */
  evidence_id?: string;
};

export type FieldTypeV1 =
  | "revenue_canonical_v1"
  | "marketing_attributed_revenue_v1"
  | "forecast_revenue_v1"
  | "deal_returns_v1"
  | "pipeline_metric_v1"
  | "other_metric_v1";

export type TypedMetric = {
  field_type: FieldTypeV1;

  /** Raw token/value matched from the source (e.g. "$2.476M") */
  value_raw: string;

  /** Normalized numeric value when parseable; null when not */
  value: number | null;

  /** Optional label shown in UI (e.g. "Revenue (2024)") */
  label: string | null;

  /** Overall extraction confidence (0..1) */
  confidence: number;

  /** Evidence references supporting this typed metric */
  sources: EvidenceRef[];

  /** Deterministic explanation of why this field_type was chosen */
  typing_reason: string;

  /** Confidence in the typing decision itself (0..1) */
  typing_confidence: number;
};