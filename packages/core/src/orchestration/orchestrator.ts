/**
 * DealOrchestrator - Core orchestration engine for DIO analysis
 * 
 * Coordinates all 6 analyzers to produce a complete DealIntelligenceObject
 * 
 * @module orchestration/orchestrator
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { AnalysisConfigSchema, DEFAULT_ANALYSIS_CONFIG } from '../types/dio.js';
import type {
  DealIntelligenceObject,
  DIOContext,
  SlideSequenceResult,
  MetricBenchmarkResult,
  VisualDesignResult,
  NarrativeArcResult,
  FinancialHealthResult,
  RiskAssessmentResult,
  AnalyzerResults,
  PlannerState,
  LedgerManifest,
  InvestmentDecision,
  NarrativeSynthesis,
  ExecutionMetadata
} from '../types/dio.js';
import type { BaseAnalyzer } from '../analyzers/base.js';
import type { DIOStorage, DIOStorageResult } from '../services/dio-storage.js';
import { buildDIOContextFromInputData } from './dio-context';
import { buildScoreExplanationFromDIO, buildScoringDiagnosticsFromDIO } from '../reports/score-explanation';
import { classifyDealForDioLike } from '../classification/deal-classifier';
import { getDealPolicy, type AnalyzerKey } from '../classification/deal-policy-registry';
import { getSelectedPolicyIdFromAny } from '../classification/get-selected-policy-id';
import { getStableDocumentId, selectDocumentRoles } from './document-roles';
import { generatePhase1DIOV1, mergePhase1IntoDIO } from '../phase1/phase1-dio-v1.js';
import { buildRealAssetFactArtifacts, detectRealEstatePreferredEquity } from './real-asset-facts';

// ==================== Configuration ====================

export const OrchestratorConfigSchema = z.object({
  maxRetries: z.number().min(0).max(5).default(2),
  analyzerTimeout: z.number().min(1000).max(300000).default(60000),
  continueOnError: z.boolean().default(true),
  debug: z.boolean().default(false),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

// ==================== Input/Output ====================

export const OrchestrationInputSchema = z.object({
  deal_id: z.string().uuid(),
  analysis_cycle: z.number().int().min(1).max(3).default(1),
  input_data: z.record(z.unknown()),
  config: OrchestratorConfigSchema.partial().optional(),
});

export type OrchestrationInput = z.infer<typeof OrchestrationInputSchema>;

export const OrchestrationResultSchema = z.object({
  success: z.boolean(),
  dio: z.custom<DealIntelligenceObject>().optional(),
  storage_result: z.custom<DIOStorageResult>().optional(),
  execution: z.object({
    total_duration_ms: z.number(),
    analyzers_run: z.number(),
    analyzers_failed: z.number(),
    retry_count: z.number(),
  }),
  failures: z.array(z.object({
    analyzer: z.string(),
    error: z.string(),
    retry_attempts: z.number(),
  })).optional(),
  error: z.string().optional(),
});

export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;

// ==================== Errors ====================

export class OrchestrationError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

export class AnalyzerTimeoutError extends Error {
  constructor(analyzerName: string, timeout: number) {
    super(`Analyzer '${analyzerName}' timed out after ${timeout}ms`);
    this.name = 'AnalyzerTimeoutError';
  }
}

// ==================== Analyzer Registry ====================

export interface AnalyzerRegistry {
  slideSequence: BaseAnalyzer<any, SlideSequenceResult>;
  metricBenchmark: BaseAnalyzer<any, MetricBenchmarkResult>;
  visualDesign: BaseAnalyzer<any, VisualDesignResult>;
  narrativeArc: BaseAnalyzer<any, NarrativeArcResult>;
  financialHealth: BaseAnalyzer<any, FinancialHealthResult>;
  riskAssessment: BaseAnalyzer<any, RiskAssessmentResult>;
}

// ==================== Core Orchestrator ====================

export class DealOrchestrator {
  private config: OrchestratorConfig;
  
  constructor(
    private analyzers: AnalyzerRegistry,
    private storage: DIOStorage,
    config?: Partial<OrchestratorConfig>
  ) {
    this.config = OrchestratorConfigSchema.parse(config || {});
  }
  
  /**
   * Run full analysis orchestration
   */
  async analyze(input: OrchestrationInput): Promise<OrchestrationResult> {
    const start_time = Date.now();
    const failures: Array<{ analyzer: string; error: string; retry_attempts: number }> = [];
    const retryCounter = { count: 0 };

    let precomputedDealClassificationV1: any | null = null;

    const ANALYZER_KEY_TO_REGISTRY: Record<AnalyzerKey, keyof AnalyzerRegistry> = {
      slide_sequence: 'slideSequence',
      metric_benchmark: 'metricBenchmark',
      visual_design: 'visualDesign',
      narrative_arc: 'narrativeArc',
      financial_health: 'financialHealth',
      risk_assessment: 'riskAssessment',
    };

    this.log('Starting orchestration', { deal_id: input.deal_id, cycle: input.analysis_cycle });
    this.log('Input data keys', { keys: Object.keys(input.input_data), documents_count: (input.input_data.documents as any[])?.length || 0 });

    try {
      // Compute lightweight derived context BEFORE analyzers run
      const computed_context = await buildDIOContextFromInputData(input.input_data);
      (input.input_data as any).dio_context = computed_context;
      // Provide a best-effort industry hint for the metric benchmark analyzer
      if (!(input.input_data as any).industry && computed_context.vertical !== 'other') {
        (input.input_data as any).industry = computed_context.vertical;
      }

      // Deterministic deal classification + policy routing BEFORE analyzers run so
      // policy-aware analyzers (e.g. metric_benchmark KPI mapping) can use it.
      try {
        const dioLike = {
          inputs: {
            documents: (input.input_data as any).documents,
            evidence: (input.input_data as any).evidence,
          },
        };
        precomputedDealClassificationV1 = classifyDealForDioLike(dioLike as any);
        (input.input_data as any).deal_classification_v1 = precomputedDealClassificationV1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log('Deal classification precompute failed (ignored)', { deal_id: input.deal_id, error: message });
        precomputedDealClassificationV1 = null;
      }

          const selectedPolicyId: string | undefined =
            getSelectedPolicyIdFromAny(input.input_data as any) ??
            (typeof precomputedDealClassificationV1?.selected_policy === 'string' ? String(precomputedDealClassificationV1.selected_policy) : undefined);

      const policy = getDealPolicy(selectedPolicyId);
      const enabledPolicyAnalyzerKeys = new Set<AnalyzerKey>([
        ...policy.required_analyzers,
        ...policy.optional_analyzers,
      ]);

      const isAnalyzerEnabled = (k: AnalyzerKey): boolean => enabledPolicyAnalyzerKeys.has(k);

      const runIfEnabled = async <T>(
        policyKey: AnalyzerKey,
        registryName: keyof AnalyzerRegistry,
      ): Promise<T | null> => {
        if (isAnalyzerEnabled(policyKey)) {
          return (await this.runAnalyzerWithRetry(registryName, input.input_data, failures, retryCounter)) as T | null;
        }

        // Do not invoke analyzer; emit an explicit insufficient_data result.
        return this.insufficientDataResult(registryName, {
          reason: `excluded_by_policy:${policy.id}`,
        }) as unknown as T;
      };

      // Run policy-selected analyzers
      const results = {
        slideSequence: (await runIfEnabled<SlideSequenceResult>('slide_sequence', 'slideSequence')),
        metricBenchmark: (await runIfEnabled<MetricBenchmarkResult>('metric_benchmark', 'metricBenchmark')),
        visualDesign: (await runIfEnabled<VisualDesignResult>('visual_design', 'visualDesign')),
        narrativeArc: (await runIfEnabled<NarrativeArcResult>('narrative_arc', 'narrativeArc')),
        financialHealth: (await runIfEnabled<FinancialHealthResult>('financial_health', 'financialHealth')),
        riskAssessment: (await runIfEnabled<RiskAssessmentResult>('risk_assessment', 'riskAssessment')),
      };

      // Aggregate into DIO
      const dio = this.aggregateDIO(input, results);

      // Store DIO
      const storage_result = await this.storage.saveDIO(dio);

      const total_duration_ms = Date.now() - start_time;
      const analyzers_run = (Object.keys(ANALYZER_KEY_TO_REGISTRY) as AnalyzerKey[])
        .filter((k) => enabledPolicyAnalyzerKeys.has(k))
        .length;
      const analyzers_failed = failures.length;

      this.log('Orchestration complete', { 
        duration_ms: total_duration_ms,
        analyzers_failed,
        dio_id: dio.dio_id 
      });

      return {
        success: true,
        dio,
        storage_result,
        execution: {
          total_duration_ms,
          analyzers_run,
          analyzers_failed,
          retry_count: retryCounter.count,
        },
        failures: failures.length > 0 ? failures : undefined,
      };

    } catch (error) {
      const total_duration_ms = Date.now() - start_time;
      this.log('Orchestration failed', { error });

      return {
        success: false,
        execution: {
          total_duration_ms,
          analyzers_run: 0,
          analyzers_failed: 6,
          retry_count: retryCounter.count,
        },
        failures,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private getDocTitle(doc: any): string {
    return (
      (typeof doc?.fileName === 'string' && doc.fileName) ||
      (typeof doc?.filename === 'string' && doc.filename) ||
      (typeof doc?.title === 'string' && doc.title) ||
      (typeof doc?.name === 'string' && doc.name) ||
      ''
    );
  }

  private pickPrimaryDeck(documents: any[]): { doc: any; score: number } | null {
    const isPdf = (doc: any): boolean => {
      const ctRaw = (typeof doc?.contentType === 'string' ? doc.contentType : (typeof doc?.content_type === 'string' ? doc.content_type : ''));
      const ct = ctRaw.toLowerCase();
      const name = this.getDocTitle(doc).toLowerCase();
      return ct.includes('pdf') || name.endsWith('.pdf');
    };

    const isPitchDeckLike = (doc: any): boolean => {
      const name = this.getDocTitle(doc).toLowerCase();
      if (name.includes('pitch') || name.includes('deck') || name.includes('presentation')) return true;

      const h = Array.isArray(doc?.mainHeadings) ? doc.mainHeadings : Array.isArray(doc?.headings) ? doc.headings : [];
      const joined = h.filter((x: any) => typeof x === 'string').join(' ').toLowerCase();
      return (
        joined.includes('problem') ||
        joined.includes('solution') ||
        joined.includes('traction') ||
        joined.includes('market') ||
        joined.includes('team') ||
        joined.includes('ask') ||
        joined.includes('raising')
      );
    };

    const toNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

    const completenessScoreOf = (doc: any): number => {
      const direct =
        toNumber(doc?.completeness?.score) ??
        toNumber(doc?.extractionMetadata?.completeness?.score) ??
        toNumber(doc?.extraction_metadata?.completeness?.score);
      if (direct != null) return Math.max(0, Math.min(1, direct));

      // Fallback heuristic mirroring worker computeCompleteness() for deterministic behavior
      const headingsCount = Array.isArray(doc?.mainHeadings) ? doc.mainHeadings.length : Array.isArray(doc?.headings) ? doc.headings.length : 0;
      const metricsCount = Array.isArray(doc?.keyMetrics) ? doc.keyMetrics.length : 0;
      const summaryLen = typeof doc?.textSummary === 'string' ? doc.textSummary.length : 0;

      let score = 0;
      if (summaryLen >= 100) score += 0.4;
      else if (summaryLen >= 20) score += 0.2;
      if (headingsCount >= 3) score += 0.3;
      else if (headingsCount >= 1) score += 0.15;
      if (metricsCount >= 5) score += 0.3;
      else if (metricsCount >= 1) score += 0.15;

      return Math.max(0, Math.min(1, score));
    };

    const totalWordsOf = (doc: any): number => {
      const direct =
        toNumber(doc?.totalWords) ??
        toNumber(doc?.total_words) ??
        toNumber(doc?.extractionMetadata?.totalWords) ??
        toNumber(doc?.extraction_metadata?.totalWords);
      if (direct != null) return Math.max(0, direct);

      const text = typeof doc?.textSummary === 'string' ? doc.textSummary : '';
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      return words;
    };

    const textItemsOf = (doc: any): number => {
      const direct =
        toNumber(doc?.textItems) ??
        toNumber(doc?.text_items) ??
        toNumber(doc?.textItemsCount) ??
        toNumber(doc?.text_items_count) ??
        toNumber(doc?.extractionMetadata?.textItems) ??
        toNumber(doc?.extraction_metadata?.textItems);
      return direct != null ? Math.max(0, direct) : 0;
    };

    const headingsCountOf = (doc: any): number => {
      const direct =
        toNumber(doc?.headingsCount) ??
        toNumber(doc?.headings_count) ??
        toNumber(doc?.extractionMetadata?.headingsCount) ??
        toNumber(doc?.extraction_metadata?.headingsCount);
      if (direct != null) return Math.max(0, direct);

      const h = Array.isArray(doc?.mainHeadings) ? doc.mainHeadings : Array.isArray(doc?.headings) ? doc.headings : [];
      return h.filter((x: any) => typeof x === 'string' && x.trim().length > 0).length;
    };

    const needsOcrOf = (doc: any): boolean => {
      const direct = doc?.needsOcr ?? doc?.needs_ocr ?? doc?.extractionMetadata?.needsOcr ?? doc?.extraction_metadata?.needsOcr;
      return Boolean(direct);
    };

    const candidates = documents.filter((d) => isPdf(d) && isPitchDeckLike(d));
    if (candidates.length < 2) return null;

    let best: { doc: any; score: number; idx: number } | null = null;
    for (let idx = 0; idx < documents.length; idx++) {
      const doc = documents[idx];
      if (!candidates.includes(doc)) continue;

      const completeness = completenessScoreOf(doc);
      const totalWords = totalWordsOf(doc);
      const textItems = textItemsOf(doc);
      const headingsCount = headingsCountOf(doc);
      const needsOcr = needsOcrOf(doc);

      const score =
        3 * completeness +
        0.002 * totalWords +
        0.001 * textItems +
        headingsCount -
        (needsOcr ? 5 : 0) -
        idx * 0.000001; // deterministic tie-break

      if (!best || score > best.score) {
        best = { doc, score, idx };
      }
    }

    return best ? { doc: best.doc, score: best.score } : null;
  }

  /**
   * Prepare analyzer-specific input from documents array
   */
  private prepareAnalyzerInput(name: keyof AnalyzerRegistry, input_data: Record<string, unknown>): any {
    const rawDocuments = input_data.documents as any[] || [];
    const dio_context = input_data.dio_context as DIOContext | undefined;
    const debug_scoring = Boolean((input_data as any)?.config?.features?.debug_scoring);
    
    if (rawDocuments.length === 0) {
      this.log(`No documents available for analyzer: ${name}`);
      return {};
    }

    // Use stable, deterministic ids even when upstream did not provide document_id
    const documents = rawDocuments.map((doc, idx) => ({
      ...doc,
      __stable_doc_id: getStableDocumentId(doc, idx),
    }));

    const roles = selectDocumentRoles(documents);
    const rolesPitchDeckDoc = roles.primary_pitch_deck_doc_id
      ? documents.find((d) => d.__stable_doc_id === roles.primary_pitch_deck_doc_id) || null
      : null;
    const financialsDoc = roles.financials_doc_id
      ? documents.find((d) => d.__stable_doc_id === roles.financials_doc_id) || null
      : null;
    const supportingDocs = new Set<string>(roles.supporting_doc_ids);

    const pickedPrimaryDeck = this.pickPrimaryDeck(documents);
    const pitchDeckDoc = pickedPrimaryDeck?.doc || rolesPitchDeckDoc;
    if (pickedPrimaryDeck && pitchDeckDoc) {
      this.log('Selected primary pitch deck (pickPrimaryDeck)', {
        doc_id: pitchDeckDoc.__stable_doc_id,
        title: this.getDocTitle(pitchDeckDoc),
        score: pickedPrimaryDeck.score,
      });
    }

    const parseNumberish = (raw: unknown): number | null => {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        // Accept summary-stat objects from spreadsheet extraction.
        // Priority: value -> avg -> mean -> max -> min
        const o = raw as Record<string, unknown>;
        const candidates: unknown[] = [o.value, o.avg, o.mean, o.max, o.min];
        for (const c of candidates) {
          const n = parseNumberish(c);
          if (n != null && Number.isFinite(n)) return n;
        }
        return null;
      }
      if (typeof raw !== 'string') return null;
      const s = raw.trim();
      if (!s) return null;

      // Handle percent
      const pct = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
      if (pct) return parseFloat(pct[1]);

      // Currency/number with K/M/B suffix
      const m = s
        .replace(/,/g, '')
        .match(/\$?\s*(-?\d+(?:\.\d+)?)\s*([kmb]|thousand|million|billion)?\b/i);
      if (!m) return null;
      const base = parseFloat(m[1]);
      if (!Number.isFinite(base)) return null;
      const mag = (m[2] || '').toLowerCase();
      const mult = mag === 'k' || mag === 'thousand' ? 1_000 : mag === 'm' || mag === 'million' ? 1_000_000 : mag === 'b' || mag === 'billion' ? 1_000_000_000 : 1;
      return base * mult;
    };

    const inferMetricName = (key: string | undefined, value: unknown, source?: unknown): string => {
      const rawKey = (key || '').toLowerCase().trim();
      const isGenericKey = rawKey === 'numeric_value' || rawKey === 'slide_title' || rawKey === 'value' || rawKey === 'number';
      const k = isGenericKey ? '' : rawKey;
      const v = (value == null ? '' : String(value)).toLowerCase();
      const s = typeof source === 'string' ? source.toLowerCase() : '';

      const combined = `${k} ${v} ${s}`;
      if (combined.includes('mrr')) return 'mrr';
      if (combined.includes('arr')) return 'arr';
      if (combined.includes('revenue') || combined.includes('sales')) return 'revenue';
      if (combined.includes('growth') || combined.includes('yoy') || combined.includes('month-over-month') || combined.includes('mom')) return 'growth_rate';
      if (combined.includes('gross margin') || combined.includes('gm')) return 'gross_margin';
      if (combined.includes('cac')) return 'cac';
      if (combined.includes('ltv') || combined.includes('clv')) return 'ltv';
      if (combined.includes('churn')) return 'churn';
      if (combined.includes('retention') || combined.includes('nrr') || combined.includes('ndr')) return combined.includes('nrr') || combined.includes('ndr') ? 'ndr' : 'retention';
      if (combined.includes('dau')) return 'dau';
      if (combined.includes('mau')) return 'mau';

      // Fund metrics
      if (combined.includes('aum') || combined.includes('assets under management')) return 'aum';
      if (combined.includes('irr')) return 'irr';
      if (combined.includes('moic') || combined.includes('multiple')) return 'moic';

      // Real estate / credit metrics
      if (combined.includes('noi') || combined.includes('net operating income')) return 'noi';
      if (combined.includes('dscr') || combined.includes('debt service coverage')) return 'dscr';
      if (combined.includes('ltv') || combined.includes('loan-to-value') || combined.includes('loan to value')) return 'ltv';
      if (combined.includes('cap rate') || combined.includes('caprate')) return 'cap_rate';
      if (combined.includes('occupancy')) return 'occupancy';
      if (combined.includes('interest coverage') || combined.includes('icr')) return 'interest_coverage';

      // Financial health cues
      if (combined.includes('cash balance') || combined.includes('cash on hand') || combined.includes('cash')) return 'cash_balance';
      if (combined.includes('burn') && combined.includes('rate')) return 'burn_rate';
      if (combined.includes('burn')) return 'burn_rate';
      if (combined.includes('expense') || combined.includes('opex') || combined.includes('cost')) return 'expenses';
      if (combined.includes('runway')) return 'runway_months';

      return rawKey || 'other';
    };

    const unitFromValue = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const v = value.toLowerCase();
      if (v.includes('%')) return '%';
      if (v.includes('$')) return '$';
      if (v.includes('month')) return 'months';
      return undefined;
    };

    const docIdOf = (doc: any): string => {
      return (
        (typeof doc?.__stable_doc_id === 'string' && doc.__stable_doc_id) ||
        (typeof doc?.document_id === 'string' && doc.document_id) ||
        (typeof doc?.id === 'string' && doc.id) ||
        'unknown'
      );
    };

    const buildExtractedMetrics = (docsToScan: any[]): Array<{ name: string; value: number; unit?: string; source_doc_id: string }> => {
      const out: Array<{ name: string; value: number; unit?: string; source_doc_id: string }> = [];

      for (const doc of docsToScan) {
        const source_doc_id = docIdOf(doc);

        // Canonical metrics (deterministic normalization output). These should take precedence.
        const canonical =
          (doc?.structured_data?.canonical?.financials?.canonical_metrics ??
            doc?.structuredData?.canonical?.financials?.canonical_metrics ??
            doc?.structured_data?.canonical?.financials?.canonicalMetrics ??
            doc?.structuredData?.canonical?.financials?.canonicalMetrics) as any;
        if (canonical && typeof canonical === 'object' && !Array.isArray(canonical)) {
          for (const [rawKey, rawValue] of Object.entries(canonical as Record<string, unknown>)) {
            const num = parseNumberish(rawValue);
            if (num == null) continue;
            out.push({
              name: rawKey,
              value: num,
              unit: rawKey === 'gross_margin' ? '%' : undefined,
              source_doc_id,
            });
          }
        }

        // keyFinancialMetrics (object) from Excel/structured extraction
        const kfm = doc?.keyFinancialMetrics;
        if (kfm && typeof kfm === 'object' && !Array.isArray(kfm)) {
          for (const [rawKey, rawValue] of Object.entries(kfm as Record<string, unknown>)) {
            const num = parseNumberish(rawValue);
            if (num == null) continue;
            const name = inferMetricName(rawKey, rawValue);
            out.push({ name, value: num, unit: unitFromValue(rawValue), source_doc_id });
          }
        }

        // keyMetrics (array) from deck/PDF extraction
        if (doc?.keyMetrics && Array.isArray(doc.keyMetrics)) {
          for (const m of doc.keyMetrics) {
            const rawKey = typeof m?.key === 'string' ? m.key : undefined;
            const rawValue = m?.value;
            const num = parseNumberish(rawValue);
            if (num == null) continue;
            const name = inferMetricName(rawKey, rawValue, m?.source);
            out.push({ name, value: num, unit: unitFromValue(rawValue), source_doc_id });
          }
        }
      }

      // De-dupe by (name, source_doc_id, value)
      const seen = new Set<string>();
      const deduped: typeof out = [];
      for (const m of out) {
        const key = `${m.source_doc_id}::${m.name}::${m.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(m);
      }
      return deduped;
    };

    const getHeadings = (doc: any): string[] => {
      const candidates: unknown[] = [
        doc?.mainHeadings,
        doc?.main_headings,
        doc?.headings,
        doc?.outlineHeadings,
        doc?.outline_headings,
        doc?.structuredData?.mainHeadings,
        doc?.structured_data?.mainHeadings,
        doc?.structuredData?.headings,
        doc?.structured_data?.headings,
      ];

      for (const v of candidates) {
        if (Array.isArray(v)) {
          const out = v.filter((h) => typeof h === 'string' && h.trim().length > 0) as string[];
          if (out.length > 0) return out;
        }
      }

      return [];
    };

    const getMetrics = (doc: any): Array<{ key: string; value: string; source: string }> => {
      const candidates: unknown[] = [
        doc?.keyMetrics,
        doc?.key_metrics,
        doc?.metrics,
        doc?.structuredData?.keyMetrics,
        doc?.structured_data?.keyMetrics,
      ];
      for (const v of candidates) {
        if (Array.isArray(v) && v.length > 0) return v as any;
      }
      return [];
    };

    const getText = (doc: any): string => {
      const candidates: unknown[] = [
        doc?.textSummary,
        doc?.text_summary,
        doc?.structuredData?.textSummary,
        doc?.structured_data?.textSummary,
        doc?.summary,
        doc?.structuredData?.summary,
        doc?.structured_data?.summary,
        doc?.full_text,
        doc?.fullText,
        doc?.fulltext,
        doc?.text,
        doc?.extracted_text,
      ];
      for (const v of candidates) {
        if (typeof v === 'string') {
          const s = v.trim();
          if (s.length > 0) return s;
        }
      }
      return '';
    };

    // Combine all document data (used for analyzers that intentionally use all docs)
    const allHeadings: string[] = [];
    const allMetrics: Array<{ key: string; value: string; source: string }> = [];
    let combinedText = '';
    let totalPages = 0;
    let totalBytes = 0;
    let totalChars = 0;

    for (const doc of documents) {
      const h = getHeadings(doc);
      if (h.length > 0) allHeadings.push(...h);

      const m = getMetrics(doc);
      if (m.length > 0) allMetrics.push(...m);

      const t = getText(doc);
      if (t) combinedText += t + '\n\n';

      if (doc?.totalPages) totalPages += doc.totalPages;
      if (doc?.fileSizeBytes) totalBytes += doc.fileSizeBytes;
      if (doc?.totalWords) totalChars += doc.totalWords * 5; // Rough estimate
      else if (t) totalChars += t.length;
    }

    // Pitch-deck-only view for deck-sensitive analyzers
    const deckDoc = pitchDeckDoc || documents[0];
    const deckHeadings: string[] = getHeadings(deckDoc);
    const deckText: string = getText(deckDoc);

    const pagesOf = (doc: any): number | null => {
      const candidates: unknown[] = [
        doc?.totalPages,
        doc?.total_pages,
        doc?.page_count,
        doc?.pageCount,
        Array.isArray(doc?.pages) ? doc.pages.length : null,
      ];
      for (const c of candidates) {
        if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
      }
      return null;
    };

    const deckPages: number = pagesOf(deckDoc) ?? 1;
    const deckBytes: number = typeof deckDoc?.fileSizeBytes === 'number' && deckDoc.fileSizeBytes > 0 ? deckDoc.fileSizeBytes : 1000;
    const deckChars: number = typeof deckDoc?.totalWords === 'number' && deckDoc.totalWords > 0 ? deckDoc.totalWords * 5 : deckText.length;

    this.log(`Preparing input for ${name}`, { 
      headings: allHeadings.length, 
      metrics: allMetrics.length,
      textLength: combinedText.length,
      documents: documents.length,
      primary_pitch_deck_doc_id: pitchDeckDoc?.__stable_doc_id ?? roles.primary_pitch_deck_doc_id,
      financials_doc_id: roles.financials_doc_id,
    });

    const extracted_metrics_all = buildExtractedMetrics(documents);
    const extracted_metrics_pitch_and_fin = buildExtractedMetrics(
      [pitchDeckDoc, financialsDoc].filter(Boolean) as any[]
    );
    const extracted_metrics_financials_only = buildExtractedMetrics(
      financialsDoc ? [financialsDoc] : []
    );

    // Prepare analyzer-specific inputs based on their schemas
    switch (name) {
      case 'slideSequence':
        return {
          debug_scoring,
          headings: deckHeadings.length > 0 ? deckHeadings : allHeadings,
        };

      case 'metricBenchmark':
        // Keep this deterministic: use pitch deck text as primary, optionally append financials text.
        // Extract metrics only from pitch deck + financials.
        const mbText = [deckText, financialsDoc ? getText(financialsDoc) : ''].filter(Boolean).join('\n\n');
        return {
          debug_scoring,
          text: mbText,
          industry: (input_data.industry as string | undefined) || (dio_context?.vertical && dio_context.vertical !== 'other' ? dio_context.vertical : undefined),
          policy_id: getSelectedPolicyIdFromAny(input_data as any) ?? undefined,
          extracted_metrics: extracted_metrics_pitch_and_fin.length > 0 ? extracted_metrics_pitch_and_fin : extracted_metrics_all,
        };

      case 'visualDesign':
        return {
          debug_scoring,
          page_count: deckPages,
          file_size_bytes: deckBytes,
          total_text_chars: deckChars > 0 ? deckChars : deckText.length,
          headings: deckHeadings.length > 0 ? deckHeadings : allHeadings,
          primary_doc_type: (dio_context as any)?.primary_doc_type,
          text_summary: typeof deckText === 'string' && deckText.length > 0 ? deckText.slice(0, 2000) : undefined,
        };

      case 'narrativeArc':
        // Build slides from the primary pitch deck only to avoid multi-doc page inflation and mismatched headings.
        const narrativeHeadings = deckHeadings.length > 0 ? deckHeadings : allHeadings;
        const slides = narrativeHeadings.map((heading) => ({
          heading,
          text: deckText ? deckText.substring(0, 500) : '',
        }));
        return {
          debug_scoring,
          slides: slides.length > 0 ? slides : [{ heading: 'Document', text: combinedText.substring(0, 500) }],
        };

      case 'financialHealth':
        // Extract financial metrics primarily from the selected financials doc.
        const finDoc = financialsDoc;
        const finMetrics = finDoc ? getMetrics(finDoc) : [];

        const financialData: any = {};
        for (const metric of finMetrics) {
          const value = (metric.value == null ? '' : String(metric.value)).toLowerCase();
          if (value.includes('revenue')) {
            const match = value.match(/\$?([\d,.]+)\s*(m|million|k|thousand)?/i);
            if (match) {
              const num = parseFloat(match[1].replace(/,/g, ''));
              const multiplier = match[2]?.toLowerCase().startsWith('m') ? 1000000 : 
                               match[2]?.toLowerCase().startsWith('k') ? 1000 : 1;
              financialData.revenue = num * multiplier;
            }
          }
          if (value.includes('growth') && value.includes('%')) {
            const match = value.match(/([\d.]+)%/);
            if (match) {
              financialData.growth_rate = parseFloat(match[1]) / 100;
            }
          }
        }
        return {
          debug_scoring,
          ...financialData,
          extracted_metrics: extracted_metrics_financials_only.length > 0 ? extracted_metrics_financials_only : extracted_metrics_all,
        };

      case 'riskAssessment':
        return {
          debug_scoring,
          pitch_text: combinedText || 'No content available',
          headings: allHeadings,
          metrics: allMetrics.reduce((acc, m) => {
            const match = (m.value == null ? '' : String(m.value)).match(/([\d.]+)/);
            if (match) {
              acc[m.key || 'unknown'] = parseFloat(match[1]);
            }
            return acc;
          }, {} as Record<string, number>),
        };

      default:
        this.log(`Unknown analyzer: ${name}, returning empty input`);
        return {};
    }
  }

  private isInsufficientInput(name: keyof AnalyzerRegistry, analyzer_input: any): boolean {
    switch (name) {
      case 'slideSequence':
        return !Array.isArray(analyzer_input?.headings) || analyzer_input.headings.length === 0;
      case 'metricBenchmark': {
        const text = typeof analyzer_input?.text === 'string' ? analyzer_input.text.trim() : '';
        const extracted = Array.isArray(analyzer_input?.extracted_metrics) ? analyzer_input.extracted_metrics : [];
        return text.length === 0 && extracted.length === 0;
      }
      case 'visualDesign': {
        const headingsMissing = !Array.isArray(analyzer_input?.headings) || analyzer_input.headings.length === 0;
        const noText = typeof analyzer_input?.total_text_chars !== 'number' || analyzer_input.total_text_chars <= 0;
        return headingsMissing && noText;
      }
      case 'narrativeArc': {
        const slides = Array.isArray(analyzer_input?.slides) ? analyzer_input.slides : [];
        if (slides.length === 0) return true;
        const hasAnyContent = slides.some((s: any) => typeof s?.text === 'string' && s.text.trim().length > 0);
        return !hasAnyContent;
      }
      case 'financialHealth': {
        const extracted = Array.isArray(analyzer_input?.extracted_metrics) ? analyzer_input.extracted_metrics : [];
        const keys = analyzer_input && typeof analyzer_input === 'object'
          ? Object.keys(analyzer_input).filter((k) => k !== 'extracted_metrics' && k !== 'evidence_ids')
          : [];
        return keys.length === 0 && extracted.length === 0;
      }
      case 'riskAssessment': {
        const pitch = typeof analyzer_input?.pitch_text === 'string' ? analyzer_input.pitch_text.trim() : '';
        return pitch.length === 0 || pitch === 'No content available';
      }
      default:
        return true;
    }
  }

  /**
   * Run analyzer with retry logic
   */
  private async runAnalyzerWithRetry<T>(
    name: keyof AnalyzerRegistry,
    input_data: Record<string, unknown>,
    failures: Array<{ analyzer: string; error: string; retry_attempts: number }>,
    retryCounter: { count: number }
  ): Promise<T | null> {
    let attempts = 0;
    const max_retries = this.config.maxRetries;

    while (attempts <= max_retries) {
      try {
        this.log(`Running analyzer: ${name}`, { attempt: attempts + 1 });
        
        const analyzer = this.analyzers[name] as BaseAnalyzer<any, T>;
        const analyzer_input = this.prepareAnalyzerInput(name, input_data);

        // If we don't have enough signal to run this analyzer, return an explicit
        // insufficient_data result without invoking the analyzer.
        if (this.isInsufficientInput(name, analyzer_input)) {
          this.log(`Skipping analyzer due to insufficient input: ${name}`);
          return this.insufficientDataResult(name) as unknown as T;
        }
        
        const promise = analyzer.analyze(analyzer_input);
        const result = await this.withTimeout(promise, this.config.analyzerTimeout, name);
        
        this.log(`Analyzer completed: ${name}`);
        return result;

      } catch (error) {
        attempts++;
        if (attempts <= max_retries) {
          retryCounter.count++;
        }
        
        const error_message = error instanceof Error ? error.message : 'Unknown error';
        this.log(`Analyzer failed: ${name}`, { attempt: attempts, error: error_message });

        if (attempts > max_retries) {
          failures.push({
            analyzer: name,
            error: error_message,
            retry_attempts: attempts - 1,
          });

          if (this.config.continueOnError) {
            this.log(`Continuing despite ${name} failure`);
            return this.extractionFailedResult(name) as unknown as T;
          } else {
            throw new OrchestrationError(`Analyzer ${name} failed after ${attempts} attempts`, error as Error);
          }
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  /**
   * Add timeout to promise
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    analyzerName: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new AnalyzerTimeoutError(analyzerName, timeout)), timeout);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }

  /**
   * Aggregate analyzer results into complete DIO
   */
  private aggregateDIO(
    input: OrchestrationInput,
    results: {
      slideSequence: SlideSequenceResult | null;
      metricBenchmark: MetricBenchmarkResult | null;
      visualDesign: VisualDesignResult | null;
      narrativeArc: NarrativeArcResult | null;
      financialHealth: FinancialHealthResult | null;
      riskAssessment: RiskAssessmentResult | null;
    }
  ): DealIntelligenceObject {
    const now = new Date().toISOString();
    const analyzerVersion = process.env.DIO_ANALYSIS_ENGINE_VERSION || '1.0.0';
    
    // Debug: check what's in input_data
    console.log('[buildDIO] input.input_data keys:', Object.keys(input.input_data));
    console.log('[buildDIO] documents count:', (input.input_data?.documents as any[])?.length || 0);
    
    // Build analyzer results with fallbacks
    const analyzer_results: AnalyzerResults = {
      slide_sequence: results.slideSequence || this.fallbackSlideSequence(),
      metric_benchmark: results.metricBenchmark || this.fallbackMetricBenchmark(),
      visual_design: results.visualDesign || this.fallbackVisualDesign(),
      narrative_arc: results.narrativeArc || this.fallbackNarrativeArc(),
      financial_health: results.financialHealth || this.fallbackFinancialHealth(),
      risk_assessment: results.riskAssessment || this.fallbackRiskAssessment(),
    };

    const documents = Array.isArray((input.input_data as any)?.documents)
      ? ((input.input_data as any).documents as DealIntelligenceObject["inputs"]["documents"])
      : [];
    const evidence = Array.isArray((input.input_data as any)?.evidence)
      ? ((input.input_data as any).evidence as DealIntelligenceObject["inputs"]["evidence"])
      : [];

    // Deterministic fact_table population for real-asset preferred equity offering memoranda.
    // This is additive and does not change analyzer behavior; it improves downstream coverage.
    const nowForFacts = now;
    const realAssetArtifacts = buildRealAssetFactArtifacts({
      documents: documents as any[],
      analysis_cycle: input.analysis_cycle,
      now_iso: nowForFacts,
    });
    if (realAssetArtifacts.appended_evidence.length > 0) {
      evidence.push(...realAssetArtifacts.appended_evidence);
    }
    
    const inputConfigRaw = (input.input_data as any)?.config;
    const mergedConfig = AnalysisConfigSchema.parse({
      ...DEFAULT_ANALYSIS_CONFIG,
      ...(inputConfigRaw && typeof inputConfigRaw === 'object' ? inputConfigRaw : {}),
      analyzer_versions: {
        slide_sequence: analyzerVersion,
        metric_benchmark: analyzerVersion,
        visual_design: analyzerVersion,
        narrative_arc: analyzerVersion,
        financial_health: analyzerVersion,
        risk_assessment: analyzerVersion,
        ...(inputConfigRaw?.analyzer_versions || {}),
      },
      features: {
        ...DEFAULT_ANALYSIS_CONFIG.features,
        ...(inputConfigRaw?.features || {}),
      },
      parameters: {
        ...DEFAULT_ANALYSIS_CONFIG.parameters,
        ...(inputConfigRaw?.parameters || {}),
      },
    });

    // Build complete DIO
    let dio: DealIntelligenceObject = {
      schema_version: '1.0.0',
      dio_id: randomUUID(),
      deal_id: input.deal_id,
      created_at: now,
      updated_at: now,
      analysis_version: 1,

      dio_context: (input.input_data as any).dio_context || this.fallbackDIOContext(),
      
      inputs: {
        documents,
        evidence,
        config: mergedConfig,
      },
      
      analyzer_results,
      
      planner_state: this.fallbackPlannerState(input.analysis_cycle),
      fact_table: realAssetArtifacts.fact_table,
      ledger_manifest: this.fallbackLedgerManifest(),
      risk_map: [],
      decision: this.fallbackDecision(),
      narrative: this.fallbackNarrative(),
      execution_metadata: this.fallbackExecutionMetadata(),
    };
    
    console.log('[buildDIO] DIO created with inputs.documents length:', dio.inputs.documents.length);

    // Phase 1 deterministic addendum (DoD): always attach under `dio.phase1.*`
    // Never fail orchestration due to Phase 1 addenda.
    try {
      const workerPhase1Overview = (input.input_data as any).phase1_deal_overview_v2;
      const phase1 = generatePhase1DIOV1({
        deal: {
          deal_id: input.deal_id,
          name: null,
          stage: null,
        },
        // Worker-provided Phase 1 extras must be included at composition time,
        // so composers (e.g., executive_summary_v2) see the populated overview.
        deal_overview_v2: (input.input_data as any).phase1_deal_overview_v2,
        business_archetype_v1: (input.input_data as any).phase1_business_archetype_v1,
        update_report_v1: (input.input_data as any).phase1_update_report_v1,
        inputDocuments: dio.inputs.documents
          .filter((d: any) => d && typeof d === 'object')
          .map((d: any, idx: number) => {
            const rawId = (d as any).document_id ?? (d as any).id ?? (d as any).documentId;
            const numericOrStringId =
              typeof rawId === 'string'
                ? rawId
                : typeof rawId === 'number' && Number.isFinite(rawId)
                  ? String(rawId)
                  : '';
            const stable = numericOrStringId.trim() ? numericOrStringId : getStableDocumentId(d, idx);
            const document_id = stable && String(stable).trim().length > 0 ? String(stable) : `idx_${idx}`;

            return {
              document_id,
            title: d.title ?? null,
            type: d.type ?? null,
            page_count: d.page_count ?? null,
            full_text: typeof d.full_text === 'string' ? d.full_text : undefined,
            fullText: typeof d.fullText === 'string' ? d.fullText : undefined,
            text_summary: typeof d.text_summary === 'string' ? d.text_summary : undefined,
            summary: typeof d.summary === 'string' ? d.summary : undefined,
            mainHeadings: Array.isArray(d.mainHeadings) ? d.mainHeadings : undefined,
            headings: Array.isArray(d.headings) ? d.headings : undefined,
            keyMetrics: Array.isArray(d.keyMetrics) ? d.keyMetrics : undefined,
            metrics: Array.isArray(d.metrics) ? d.metrics : undefined,
            pages: Array.isArray(d.pages) ? d.pages : undefined,
            };
          })
          .filter((d: any) => typeof d.document_id === 'string' && d.document_id.trim().length > 0),
      });

      const normalizedPhase1Overview = (phase1 as any)?.deal_overview_v2;
      const mergedPhase1Overview = {
        ...(workerPhase1Overview && typeof workerPhase1Overview === 'object' ? workerPhase1Overview : {}),
        ...(normalizedPhase1Overview && typeof normalizedPhase1Overview === 'object' ? normalizedPhase1Overview : {}),
      };

      const phase1WithWorkerExtras = {
        ...(phase1 as any),
        // Preserve normalized canonical fields while still retaining any worker-provided synonym keys.
        deal_overview_v2: Object.keys(mergedPhase1Overview).length > 0 ? mergedPhase1Overview : undefined,
        business_archetype_v1: (input.input_data as any).phase1_business_archetype_v1,
        update_report_v1: (input.input_data as any).phase1_update_report_v1,
		// Additive: optional investor-readable synthesis from worker (Phase 1 only)
		deal_summary_v2: (input.input_data as any).phase1_deal_summary_v2,
      };

      dio = mergePhase1IntoDIO(dio as any, phase1WithWorkerExtras as any) as DealIntelligenceObject;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('Phase 1 addendum failed (ignored)', { deal_id: input.deal_id, error: message });
    }

    // Merge worker-provided dependency logs (best-effort; never fail DIO build).
    try {
      const incomingCalls = Array.isArray((input.input_data as any)?.llm_calls)
        ? ((input.input_data as any).llm_calls as any[])
        : [];
      if (incomingCalls.length > 0) {
        const merged = [...dio.execution_metadata.dependencies.llm_calls, ...incomingCalls]
          .filter((c: any) => c && typeof c === 'object');

        dio.execution_metadata = {
          ...dio.execution_metadata,
          dependencies: {
            ...dio.execution_metadata.dependencies,
            llm_calls: merged as any,
          },
          performance: {
            ...dio.execution_metadata.performance,
            llm_total_ms:
              (dio.execution_metadata.performance?.llm_total_ms ?? 0) +
              merged.reduce((sum: number, c: any) => sum + (typeof c?.duration_ms === 'number' ? c.duration_ms : 0), 0),
          },
        };

        // If narrative is still fallback, at least surface token usage totals for observability.
        const tokenTotals = merged.reduce(
          (acc: { input: number; output: number; total: number; cost: number }, c: any) => {
            const tu = c?.token_usage;
            acc.input += typeof tu?.input_tokens === 'number' ? tu.input_tokens : 0;
            acc.output += typeof tu?.output_tokens === 'number' ? tu.output_tokens : 0;
            acc.total += typeof tu?.total_tokens === 'number' ? tu.total_tokens : 0;
            acc.cost += typeof tu?.estimated_cost === 'number' ? tu.estimated_cost : 0;
            return acc;
          },
          { input: 0, output: 0, total: 0, cost: 0 }
        );

        if (dio.narrative && dio.narrative.executive_summary === 'Analysis incomplete') {
          dio.narrative = {
            ...dio.narrative,
            token_usage: {
              input_tokens: tokenTotals.input,
              output_tokens: tokenTotals.output,
              total_tokens: tokenTotals.total,
              estimated_cost: tokenTotals.cost,
            },
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('LLM call merge failed (ignored)', { deal_id: input.deal_id, error: message });
    }

    // Confidence gate for real-asset offering memos: if fact coverage is missing,
    // mark low-confidence and add a verification blocker instead of proceeding silently.
    try {
      const primaryText = Array.isArray(documents) && documents.length > 0
        ? (() => {
            const d0: any = (documents as any[]).find((d) => typeof d?.full_text === 'string' && d.full_text.trim().length > 0)
              ?? (documents as any[]).find((d) => typeof d?.fullText === 'string' && d.fullText.trim().length > 0)
              ?? (documents as any[])[0];
            const t =
              (typeof d0?.full_text === 'string' ? d0.full_text : '') ||
              (typeof d0?.fullText === 'string' ? d0.fullText : '') ||
              (typeof d0?.text_summary === 'string' ? d0.text_summary : '') ||
              (typeof d0?.textSummary === 'string' ? d0.textSummary : '') ||
              (typeof d0?.summary === 'string' ? d0.summary : '');
            return typeof t === 'string' ? t : '';
          })()
        : '';

      const isRealAssetMemo = detectRealEstatePreferredEquity(primaryText);
      const MIN_FACTS = 8;

      if (isRealAssetMemo && (!Array.isArray(dio.fact_table) || dio.fact_table.length < MIN_FACTS)) {
        const existing = Array.isArray(dio.decision.verification_checklist) ? dio.decision.verification_checklist : [];
        dio.decision = {
          ...dio.decision,
          confidence: Math.min(dio.decision.confidence ?? 0.5, 0.2),
          recommendation: 'CONDITIONAL',
          verification_checklist: [
            ...existing,
            `Blocker: insufficient real-asset fact coverage (need >=${MIN_FACTS} evidence-backed facts)`
          ],
        };
        if (dio.dio_context) {
          dio.dio_context = {
            ...dio.dio_context,
            confidence: Math.min(dio.dio_context.confidence ?? 0.8, 0.4),
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('Real-asset confidence gate failed (ignored)', { deal_id: input.deal_id, error: message });
    }

    // Deterministic deal classification + policy routing (additive, does not replace deal_type).
    try {
      const deal_classification_v1 =
        (input.input_data as any)?.deal_classification_v1 ?? classifyDealForDioLike(dio as any);
      (dio as any).dio = {
        ...((dio as any).dio ?? {}),
        deal_classification_v1,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log('Deal classification failed (ignored)', { deal_id: input.deal_id, error: message });
    }

    // Attach score explainability and an extracted overall_score for downstream consumers.
    // Storage persists its own score_explanation/overall_score, but this makes the in-memory DIO consistent.
    const score_explanation = buildScoreExplanationFromDIO(dio);
    (dio as any).score_explanation = score_explanation;
    (dio as any).overall_score = score_explanation.totals.overall_score;

    // Persisted, UI-ready diagnostics: always explains red-flags vs coverage gaps.
    (dio as any).scoring_diagnostics_v1 = buildScoringDiagnosticsFromDIO(dio);
    if (score_explanation.totals.overall_score == null) {
      dio.decision = {
        ...dio.decision,
        confidence: Math.min(dio.decision.confidence ?? 0.5, 0.2),
      };
    }
    
    return dio;
  }

  // ==================== Fallback Helpers ====================

  private fallbackSlideSequence(): SlideSequenceResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      score: null,
      pattern_match: 'unknown',
      sequence_detected: [],
      expected_sequence: [],
      deviations: [],
      evidence_ids: [],
    } as any;
  }

  private fallbackMetricBenchmark(): MetricBenchmarkResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      metrics_analyzed: [],
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      overall_score: null,
      evidence_ids: [],
    } as any;
  }

  private fallbackVisualDesign(): VisualDesignResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      design_score: null,
      proxy_signals: {
        page_count_appropriate: false,
        image_to_text_ratio_balanced: false,
        consistent_formatting: false,
      },
      strengths: [],
      weaknesses: ['Analysis failed'],
      note: 'Fallback - analysis failed',
      evidence_ids: [],
    } as any;
  }

  private fallbackNarrativeArc(): NarrativeArcResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      archetype: 'unknown',
      archetype_confidence: 0,
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      pacing_score: null,
      emotional_beats: [],
      evidence_ids: [],
    } as any;
  }

  private fallbackFinancialHealth(): FinancialHealthResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      runway_months: null,
      burn_multiple: null,
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      health_score: null,
      metrics: {
        revenue: null,
        expenses: null,
        cash_balance: null,
        burn_rate: null,
        growth_rate: null,
      },
      risks: [],
      evidence_ids: [],
    } as any;
  }

  private insufficientDataResult(name: keyof AnalyzerRegistry, opts?: { reason?: string }): any {
    const now = new Date().toISOString();
    const reason = typeof opts?.reason === 'string' && opts.reason.trim().length > 0 ? opts.reason.trim() : undefined;

    switch (name) {
      case 'slideSequence':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          score: null,
          ...(reason ? { notes: [reason] } : {}),
          pattern_match: 'unknown',
          sequence_detected: [],
          expected_sequence: [],
          deviations: [],
          evidence_ids: [],
        };
      case 'metricBenchmark':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          metrics_analyzed: [],
          overall_score: null,
          ...(reason ? { note: reason } : {}),
          evidence_ids: [],
        };
      case 'visualDesign':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          design_score: null,
          proxy_signals: {
            page_count_appropriate: false,
            image_to_text_ratio_balanced: false,
            consistent_formatting: false,
          },
          strengths: [],
          weaknesses: [],
          note: reason ? `Insufficient data (${reason})` : 'Insufficient data',
          evidence_ids: [],
        };
      case 'narrativeArc':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          archetype: 'unknown',
          archetype_confidence: 0,
          pacing_score: null,
          emotional_beats: [],
          evidence_ids: [],
        };
      case 'financialHealth':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          runway_months: null,
          burn_multiple: null,
          health_score: null,
          metrics: {
            revenue: null,
            expenses: null,
            cash_balance: null,
            burn_rate: null,
            growth_rate: null,
          },
          risks: [],
          evidence_ids: [],
        };
      case 'riskAssessment':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
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
          ...(reason ? { note: reason } : {}),
          evidence_ids: [],
        };
      default:
        return { status: 'insufficient_data', coverage: 0, confidence: 0.3 };
    }
  }

  private extractionFailedResult(name: keyof AnalyzerRegistry): any {
    const now = new Date().toISOString();
    switch (name) {
      case 'slideSequence':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          coverage: 0,
          confidence: 0,
          score: null,
          pattern_match: 'unknown',
          sequence_detected: [],
          expected_sequence: [],
          deviations: [],
          evidence_ids: [],
        };
      case 'metricBenchmark':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          coverage: 0,
          confidence: 0,
          metrics_analyzed: [],
          overall_score: null,
          evidence_ids: [],
        };
      case 'visualDesign':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          coverage: 0,
          confidence: 0,
          design_score: null,
          proxy_signals: {
            page_count_appropriate: false,
            image_to_text_ratio_balanced: false,
            consistent_formatting: false,
          },
          strengths: [],
          weaknesses: ['Analysis failed'],
          note: 'Extraction failed',
          evidence_ids: [],
        };
      case 'narrativeArc':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          coverage: 0,
          confidence: 0,
          archetype: 'unknown',
          archetype_confidence: 0,
          pacing_score: null,
          emotional_beats: [],
          evidence_ids: [],
        };
      case 'financialHealth':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          coverage: 0,
          confidence: 0,
          runway_months: null,
          burn_multiple: null,
          health_score: null,
          metrics: {
            revenue: null,
            expenses: null,
            cash_balance: null,
            burn_rate: null,
            growth_rate: null,
          },
          risks: [],
          evidence_ids: [],
        };
      case 'riskAssessment':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          coverage: 0,
          confidence: 0,
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
          evidence_ids: [],
        };
      default:
        return { status: 'extraction_failed' };
    }
  }

  private fallbackRiskAssessment(): RiskAssessmentResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      overall_risk_score: 100,
      risks_by_category: {
        market: [],
        team: [],
        financial: [],
        execution: [],
      },
      total_risks: 0,
      critical_count: 0,
      high_count: 0,
      evidence_ids: [],
    };
  }

  private fallbackDIOContext(): DIOContext {
    return {
      primary_doc_type: 'other',
      deal_type: 'other',
      vertical: 'other',
      stage: 'unknown',
      confidence: 0,
    };
  }

  private fallbackPlannerState(cycle: number): PlannerState {
    return {
      cycle,
      goals: [],
      constraints: [],
      hypotheses: [],
      subgoals: [],
      focus: 'initialization',
      stop_reason: null,
    };
  }

  private fallbackLedgerManifest(): LedgerManifest {
    return {
      cycles: 0,
      depth_delta: [],
      subgoals: 0,
      constraints: 0,
      dead_ends: 0,
      paraphrase_invariance: 0,
      calibration: {
        brier: 0,
      },
      total_facts_added: 0,
      total_evidence_cited: 0,
      uncertain_claims: 0,
    };
  }

  private fallbackDecision(): InvestmentDecision {
    return {
      recommendation: 'CONDITIONAL',
      confidence: 0.5,
      tranche_plan: {
        t0_amount: null,
        milestones: [],
      },
      verification_checklist: [],
      key_strengths: [],
      key_weaknesses: [],
      evidence_ids: [],
    };
  }

  private fallbackNarrative(): NarrativeSynthesis {
    const now = new Date().toISOString();
    return {
      llm_version: '1.0.0',
      generated_at: now,
      token_usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
      },
      executive_summary: 'Analysis incomplete',
      coherence_score: null,
    };
  }

  private fallbackExecutionMetadata(): ExecutionMetadata {
    const now = new Date().toISOString();
    return {
      started_at: now,
      completed_at: now,
      duration_ms: 0,
      worker_version: '1.0.0',
      environment: 'development',
      dependencies: {
        mcp_calls: [],
        tavily_searches: [],
        llm_calls: [],
      },
      errors: [],
      warnings: [],
      performance: {
        document_load_ms: 0,
        analyzer_total_ms: 0,
        mcp_total_ms: 0,
        tavily_total_ms: 0,
        llm_total_ms: 0,
      },
    };
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: Record<string, any>): void {
    if (this.config.debug) {
      console.log(`[DealOrchestrator] ${message}`, data || '');
    }
  }
}
