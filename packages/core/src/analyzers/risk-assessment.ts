/**
 * Risk Assessment Engine v1.0.0
 * 
 * Multi-category risk detection with severity mapping
 * Text-based risk detection from pitch content
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import { buildRulesFromBaseAndDeltas } from "./debug-scoring";
import type { DebugScoringTrace, RiskAssessmentInput, RiskAssessmentResult, Risk } from "../types/dio";

const normalizeKey = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

export type RealEstateUnderwritingProtections = {
  lease_term_months: number | null;
  occupancy: number | null;
  dscr: number | null;
  has_nnn_lease: boolean;
  has_guaranty: boolean;
  protections_score: number; // 0..5
  fully_protected: boolean;
};

export function detectRealEstateUnderwritingProtections(params: {
  pitch_text: string;
  metrics?: Record<string, number> | undefined;
}): RealEstateUnderwritingProtections {
  const text = (params.pitch_text || "").toLowerCase();
  const metricsRaw = params.metrics && typeof params.metrics === "object" ? params.metrics : {};

  const metrics = new Map<string, number>();
  for (const [k, v] of Object.entries(metricsRaw)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    metrics.set(normalizeKey(k), v);
  }

  const fromMetrics = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = metrics.get(normalizeKey(k));
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  };

  const parseFirst = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  const parseLeaseTermMonths = (): number | null => {
    // Prefer explicit lease term mention.
    const m = text.match(/(?:lease\s+term|walt|weighted\s+average\s+lease\s+term)\D{0,20}(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m)\b/);
    if (m) {
      const num = parseFloat(m[1]);
      if (!Number.isFinite(num)) return null;
      const unit = m[2];
      if (/year|yr\b|y\b/.test(unit)) return Math.round(num * 12);
      return Math.round(num);
    }

    // Fallback: if a metric key exists.
    const v = fromMetrics(["lease_term_months", "lease_term", "walt"]);
    if (v == null) return null;
    // Heuristic: <= 40 likely years, else months.
    if (v > 0 && v <= 40) return Math.round(v * 12);
    return Math.round(v);
  };

  const lease_term_months = parseLeaseTermMonths();
  const occupancy =
    parseFirst(/occupancy(?:\s+rate)?\D{0,10}(\d+(?:\.\d+)?)\s*%/) ??
    fromMetrics(["occupancy", "occupancy_rate"]);

  const dscr =
    parseFirst(/dscr\D{0,10}(\d+(?:\.\d+)?)/) ??
    fromMetrics(["dscr", "debt_service_coverage_ratio"]);

  const has_nnn_lease = /absolute\s+nnn|\bnnn\b|triple\s+net/.test(text);
  const has_guaranty = /corporate\s+guarant|\bguarant(?:y|ee)\b/.test(text);

  const leaseOk = typeof lease_term_months === "number" && lease_term_months >= 120;
  const occOk = typeof occupancy === "number" && occupancy >= 95;
  const dscrOk = typeof dscr === "number" && dscr >= 1.3;

  const protections_score =
    (leaseOk ? 1 : 0) +
    (occOk ? 1 : 0) +
    (has_nnn_lease ? 1 : 0) +
    (has_guaranty ? 1 : 0) +
    (dscrOk ? 1 : 0);

  return {
    lease_term_months,
    occupancy,
    dscr,
    has_nnn_lease,
    has_guaranty,
    protections_score,
    fully_protected: protections_score === 5,
  };
}

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class RiskAssessmentEngine extends BaseAnalyzer<RiskAssessmentInput, RiskAssessmentResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "risk_assessment_engine",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - text-based risk detection"
  };

  /**
   * Analyze risks from pitch text and metrics
   */
  async analyze(input: RiskAssessmentInput): Promise<RiskAssessmentResult> {
    const executed_at = new Date().toISOString();

    const debugEnabled = Boolean((input as any).debug_scoring);

    const documents_text = Array.isArray((input as any).documents)
      ? ((input as any).documents as any[])
          .map((d: any) => (typeof d?.full_text === "string" ? d.full_text : ""))
          .join("\n")
      : "";

    const evidence_text = Array.isArray((input as any).evidence)
      ? ((input as any).evidence as any[])
          .map((e: any) => (typeof e?.text === "string" ? e.text : ""))
          .join("\n")
      : "";

    const pitch_text = typeof (input as any).pitch_text === "string" ? String((input as any).pitch_text) : "";

    // Per spec: documents[*].full_text + evidence[*].text + pitch_text (if present), all lowercased.
    const haystack = (documents_text + "\n" + evidence_text + "\n" + pitch_text).toLowerCase();
    const documents_len = documents_text.trim().length;
    const evidence_len = evidence_text.trim().length;
    const pitch_len = pitch_text.trim().length;

    if (Math.max(documents_len, evidence_len, pitch_len) < 10) {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["documents", "evidence", "pitch_text"],
            exclusion_reason: "missing_text",
            input_summary: {
              completeness: { score: 0, notes: ["documents/evidence/pitch_text missing/too short"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            rules: [{ rule_id: "excluded", description: "Excluded: documents/evidence/pitch_text missing/too short", delta: 0, running_total: 0 }],
            final: { score: null, formula: "N/A (insufficient input)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "insufficient_data",
        coverage: 0,
        confidence: 0.3,

        overall_risk_score: null,
        risks_by_category: {
          market: [],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    try {
      const policyId = typeof (input as any).policy_id === "string" ? String((input as any).policy_id) : undefined;
      // Keep existing generic risk detection logic, but run it on the haystack.
      const detected_risks = this.detectRisks({ ...input, pitch_text: haystack } as any);
      const risk_note = "No explicit risk signals detected; using neutral baseline=50";
      let overall_risk_score = detected_risks.length === 0 ? 50 : this.calculateRiskScore(detected_risks);

      // RE policy reducer (policy-scoped): if haystack contains >=3 protections, reduce risk to 25.
      // Otherwise preserve existing RE behavior and global behavior.
      let reProtections: RealEstateUnderwritingProtections | null = null;
      let reProtectionsTriggered = false;
      let reProtectionsList: string[] = [];
      if (policyId === "real_estate_underwriting") {
        const protections: Array<{ label: string; present: boolean }> = [
          {
            label: "absolute nnn",
            present: /\babsolute\s+nnn\b/.test(haystack) || (haystack.includes("absolute") && /\bnnn\b/.test(haystack)),
          },
          {
            label: "triple net",
            present: /\btriple\s+net\b/.test(haystack) || /\btriple-net\b/.test(haystack),
          },
          {
            label: "20-year lease",
            present: /\b20\s*-\s*year\s+lease\b/.test(haystack) || /\b20\s+year\s+lease\b/.test(haystack) || /\b20-year\s+lease\b/.test(haystack),
          },
          {
            label: "guaranty",
            present: /\bguarant(?:y|ee)\b/.test(haystack) || /\bguarant\w+\b/.test(haystack) || /\bguaranteed\s+lease\b/.test(haystack),
          },
          {
            label: "100% leased",
            present: /\b100%\s*leased\b/.test(haystack),
          },
          {
            label: "pre-leased",
            present: /\bpre\s*-\s*leased\b/.test(haystack) || /\bpre\s+leased\b/.test(haystack) || /\bpreleased\b/.test(haystack),
          },
        ];

        reProtectionsList = protections.filter((p) => p.present).map((p) => p.label);
        if (reProtectionsList.length >= 3) {
          overall_risk_score = 25;
          reProtectionsTriggered = true;
        } else if (detected_risks.length === 0) {
          // Preserve previous RE non-trigger behavior (protections-score heuristic).
          reProtections = detectRealEstateUnderwritingProtections({ pitch_text: haystack, metrics: input.metrics });
          const s = reProtections.protections_score;
          const reduced = s >= 5 ? 25 : s === 4 ? 35 : s === 3 ? 40 : s === 2 ? 45 : 50;
          overall_risk_score = reduced;
        }
      }
      const risks_by_category = this.groupByCategory(detected_risks);
      const critical_count = detected_risks.filter(r => r.severity === "critical").length;
      const high_count = detected_risks.filter(r => r.severity === "high").length;

      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? (() => {
            const severityPoints: Record<string, number> = {
              critical: 100,
              high: 70,
              medium: 40,
              low: 20,
            };

            const signals = [
              { key: "haystack_length", value: haystack.length },
              { key: "risks_detected", value: detected_risks.length },
              { key: "critical_count", value: critical_count },
              { key: "high_count", value: high_count },
            ];

            const penalties = detected_risks.slice(0, 10).map((r) => ({
              key: `risk:${r.category}:${r.severity}`,
              points: severityPoints[r.severity] ?? 0,
              note: r.description,
            }));

            const rules: NonNullable<DebugScoringTrace["rules"]> = (() => {
              // Mirror actual scoring:
              // - if no risks: baseline=50
              // - else: score = round(mean(severity_points)) clamped to 100
              if (detected_risks.length === 0) {
                return buildRulesFromBaseAndDeltas({
                  base: 50,
                  base_rule_id: "baseline",
                  base_description: "Neutral baseline when no explicit risks detected",
                  final_score: overall_risk_score,
                  clamp_range: { min: 0, max: 100 },
                });
              }

              const severity_weights = {
                critical: 100,
                high: 70,
                medium: 40,
                low: 20,
              } as const;

              const out: NonNullable<DebugScoringTrace["rules"]> = [];
              let running = 0;
              out.push({ rule_id: "base", description: "Start total severity points", delta: 0, running_total: running });

              for (const r of detected_risks) {
                const pts = (severity_weights as any)[r.severity] ?? 0;
                running += pts;
                out.push({
                  rule_id: `risk:${r.risk_id}`,
                  description: `${r.category}/${r.severity}: ${r.description}`,
                  delta: pts,
                  running_total: running,
                });
              }

              const avg = detected_risks.length > 0 ? running / detected_risks.length : 0;
              const deltaToAvg = avg - running;
              running = avg;
              out.push({
                rule_id: "average",
                description: `Average severity points = total / ${detected_risks.length}`,
                delta: deltaToAvg,
                running_total: running,
              });

              const final = Math.min(100, Math.round(avg));
              const deltaToFinal = final - running;
              if (Math.abs(deltaToFinal) > 1e-9) {
                running = final;
                out.push({
                  rule_id: "final_adjust",
                  description: "Final adjustment (rounding/clamp)",
                  delta: deltaToFinal,
                  running_total: running,
                });
              }

              return out;
            })();

            const completenessNotes: string[] = [];
            completenessNotes.push(haystack.length >= 10 ? "text present" : "text short");
            if (Array.isArray(input.headings) && input.headings.length > 0) completenessNotes.push("headings present");
            if (input.metrics && Object.keys(input.metrics).length > 0) completenessNotes.push("metrics present");

            return {
              inputs_used: ["documents", "evidence", "pitch_text", "headings", "metrics", "team_size", "evidence_ids", "policy_id"],
              exclusion_reason: null,
              input_summary: {
                completeness: {
                  score: Math.min(1, (haystack.length >= 10 ? 0.6 : 0) + (Array.isArray(input.headings) && input.headings.length > 0 ? 0.2 : 0) + (input.metrics && Object.keys(input.metrics).length > 0 ? 0.2 : 0)),
                  notes: completenessNotes,
                },
                signals_count: signals.length + penalties.length,
              },
              signals,
              penalties,
              bonuses: detected_risks.length === 0 ? [{ key: "no_signal_baseline", points: 50, note: risk_note }] : [],
              rules,
              final: {
                score: overall_risk_score,
                formula: detected_risks.length === 0
                  ? "baseline risk score = 50 when no explicit risks detected"
                  : "risk_score = round(mean(severity_points)) where critical=100 high=70 medium=40 low=20",
              },
            };
          })()
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "ok",
        coverage: 0.8,
        confidence: 0.75,

        overall_risk_score,
        risks_by_category,
        total_risks: detected_risks.length,
        critical_count,
        high_count,
        note: reProtectionsTriggered
          ? `RE protections detected: ${reProtectionsList.join(", ")}; risk_score=25`
          : (detected_risks.length === 0
              ? (policyId === "real_estate_underwriting" && reProtections && reProtections.protections_score >= 2
                  ? `Protections detected (score=${reProtections.protections_score}/5); reduced risk below neutral baseline`
                  : risk_note)
              : undefined),
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    } catch {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["pitch_text", "headings", "metrics", "team_size", "evidence_ids"],
            exclusion_reason: "extraction_failed",
            input_summary: {
              completeness: { score: 0.5, notes: ["exception during analysis"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            rules: [{ rule_id: "excluded", description: "Excluded: extraction_failed", delta: 0, running_total: 0 }],
            final: { score: null, formula: "N/A (extraction_failed)" },
          }
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "extraction_failed",
        coverage: 0,
        confidence: 0.2,

        overall_risk_score: null,
        risks_by_category: {
          market: [],
          team: [],
          financial: [],
          execution: [],
        },
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }
  }

  /**
   * Validate input
   */
  validateInput(input: RiskAssessmentInput): ValidationResult {
    const errors: string[] = [];
    const documents_text = Array.isArray((input as any).documents)
      ? ((input as any).documents as any[])
          .map((d: any) => (typeof d?.full_text === "string" ? d.full_text : ""))
          .join("\n")
      : "";
    const evidence_text = Array.isArray((input as any).evidence)
      ? ((input as any).evidence as any[])
          .map((e: any) => (typeof e?.text === "string" ? e.text : ""))
          .join("\n")
      : "";
    const pitch_text = typeof (input as any).pitch_text === "string" ? String((input as any).pitch_text) : "";
    const documents_len = documents_text.trim().length;
    const evidence_len = evidence_text.trim().length;
    const pitch_len = pitch_text.trim().length;

    if (Math.max(documents_len, evidence_len, pitch_len) < 10) {
      errors.push("documents/evidence/pitch_text text required and must be at least 10 characters");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Detect risks from text analysis and metrics
   */
  private detectRisks(input: RiskAssessmentInput): Risk[] {
    const risks: Risk[] = [];
    const default_evidence_id = input.evidence_ids?.[0] || "00000000-0000-0000-0000-000000000000";
    const text_lower = (input.pitch_text || "").toLowerCase();

    // Team risks
    if (input.team_size !== undefined && input.team_size < 3) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "team",
        severity: "medium",
        description: "Small team size - may struggle with execution at scale",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("looking for") && text_lower.includes("cto")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "team",
        severity: "high",
        description: "Key technical role unfilled - CTO position vacant",
        evidence_id: default_evidence_id,
      });
    }

    // Market risks
    if (text_lower.includes("crowded market") || text_lower.includes("many competitors")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "market",
        severity: "medium",
        description: "Competitive market landscape mentioned",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("niche") && !text_lower.includes("large")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "market",
        severity: "low",
        description: "Niche market - may limit growth potential",
        evidence_id: default_evidence_id,
      });
    }

    // Financial risks
    if (input.metrics?.runway !== undefined && input.metrics.runway < 6) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "financial",
        severity: "critical",
        description: `Critical runway - only ${input.metrics.runway} months remaining`,
        evidence_id: default_evidence_id,
      });
    }

    if (input.metrics?.burn_rate !== undefined && input.metrics.burn_rate > 100000) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "financial",
        severity: "high",
        description: "High burn rate detected",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("pre-revenue") || text_lower.includes("no revenue")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "financial",
        severity: "medium",
        description: "Pre-revenue stage - monetization unproven",
        evidence_id: default_evidence_id,
      });
    }

    // Execution risks
    if (text_lower.includes("mvp") || text_lower.includes("prototype")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "execution",
        severity: "medium",
        description: "Early product stage - significant development ahead",
        evidence_id: default_evidence_id,
      });
    }

    if (text_lower.includes("regulatory") || text_lower.includes("compliance")) {
      risks.push({
        risk_id: this.generateRiskId(),
        category: "execution",
        severity: "high",
        description: "Regulatory requirements - approval timeline uncertain",
        evidence_id: default_evidence_id,
      });
    }

    return risks;
  }

  /**
   * Generate unique risk ID
   */
  private generateRiskId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Calculate overall risk score (0-100, higher = more risk)
   */
  private calculateRiskScore(risks: Risk[]): number {
    if (risks.length === 0) return 0;

    const severity_weights = {
      critical: 100,
      high: 70,
      medium: 40,
      low: 20
    };

    const total = risks.reduce((sum, risk) => {
      return sum + (severity_weights[risk.severity] || 0);
    }, 0);

    const avg_score = total / risks.length;
    return Math.min(100, Math.round(avg_score));
  }

  /**
   * Group risks by category (all categories must be present)
   */
  private groupByCategory(risks: Risk[]): {
    market: Risk[];
    team: Risk[];
    financial: Risk[];
    execution: Risk[];
  } {
    const grouped = {
      market: [] as Risk[],
      team: [] as Risk[],
      financial: [] as Risk[],
      execution: [] as Risk[],
    };

    for (const risk of risks) {
      grouped[risk.category].push(risk);
    }

    return grouped;
  }
}

// Export singleton instance
export const riskAssessmentEngine = new RiskAssessmentEngine();
