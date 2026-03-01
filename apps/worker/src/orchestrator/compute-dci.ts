/**
 * Document Confidence Index (DCI)
 *
 * Authoritative spec: docs/Active/orchestractor/DDAI_DCI_v1.md
 *
 * Range: 0–100. Higher is better.
 * Deterministic. No LLM.
 */

import type { DciBand, DocumentConfidence, DocumentConfidenceInputs } from "./types.js";

// ─── Primitives ───────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ─── DCI input type ───────────────────────────────────────────────────────────

export interface DciRawInputs {
  /** 0–100 — derived from dpu_nonempty_pages / dpu_page_count */
  text_coverage_pct: number;
  /** 0–100 — from financial_layout_classifier_v1.layout_coverage_pct; use 0 if no XLSX */
  layout_coverage_pct: number;
  /** Total expected pages (or 0 when unknown) */
  expected_pages_total: number;
  /** Actual DPU rows present */
  dpu_rows_total: number;
  /** Pages with no text / soft-missing */
  missing_pages_total: number;
  /** Pages confirmed absent (hard gap) */
  hard_missing_pages_total: number;
}

function computeDpuIntegrity(inputs: DciRawInputs): { score: number; notes: string[] } {
  const notes: string[] = [];
  let integrity = 100;

  if (inputs.hard_missing_pages_total > 0) {
    integrity -= 60;
    notes.push(
      `Hard missing pages: ${inputs.hard_missing_pages_total} (−60 to DPU integrity)`
    );
  }

  if (inputs.missing_pages_total > 0) {
    const penalty = Math.min(30, inputs.missing_pages_total * 5);
    integrity -= penalty;
    notes.push(
      `Soft missing pages: ${inputs.missing_pages_total} (−${penalty} to DPU integrity)`
    );
  }

  if (inputs.expected_pages_total > 0) {
    const completionPct = (100 * inputs.dpu_rows_total) / inputs.expected_pages_total;
    if (completionPct < 95) {
      const penalty = Math.min(25, Math.round((95 - completionPct) * 1.5));
      integrity -= penalty;
      notes.push(
        `DPU completion ${completionPct.toFixed(1)}% < 95% (−${penalty} to DPU integrity)`
      );
    }
  }

  return { score: clamp(integrity, 0, 100), notes };
}

function dciBand(score: number): DciBand {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 50) return "Partial";
  return "Weak";
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute the Document Confidence Index.
 *
 * DCI = round(0.50 * text_cov + 0.30 * dpu_integrity + 0.20 * layout_cov)
 */
export function computeDocumentConfidenceIndex(raw: DciRawInputs): DocumentConfidence {
  const textCov = clamp(raw.text_coverage_pct, 0, 100);
  const layoutCov = clamp(raw.layout_coverage_pct ?? 0, 0, 100);

  const { score: dpuIntegrity, notes: integrityNotes } = computeDpuIntegrity(raw);

  const score = clamp(
    Math.round(0.5 * textCov + 0.3 * dpuIntegrity + 0.2 * layoutCov),
    0,
    100
  );

  const notes: string[] = [...integrityNotes];
  if (layoutCov === 0) {
    notes.push("XLSX layout coverage absent — treated as 0 (conservative DCI).");
  }

  const inputs: DocumentConfidenceInputs = {
    text_coverage_pct: textCov,
    layout_coverage_pct: layoutCov,
    dpu_integrity_score: dpuIntegrity,
    expected_pages_total: raw.expected_pages_total,
    dpu_rows_total: raw.dpu_rows_total,
    missing_pages_total: raw.missing_pages_total,
    hard_missing_pages_total: raw.hard_missing_pages_total,
  };

  return { score, band: dciBand(score), inputs, notes };
}
