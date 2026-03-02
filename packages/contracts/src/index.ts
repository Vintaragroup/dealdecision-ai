// Shared contracts for DealDecision AI

// Deal Stage Workflow:
// Intake: Deal created + documents uploaded (pre-analysis)
// Under Review: First analysis complete, AI identified gaps/opportunities
// In Due Diligence: Investor actively addressing identified gaps
// Ready for Decision: DD complete, confidence >= 70%, investment-ready
// Pitched: Deal presented or investment decision made
export type DealStage = 'intake' | 'under_review' | 'in_diligence' | 'ready_decision' | 'pitched';
export type DealPriority = 'high' | 'medium' | 'low';
export type DealTrend = 'up' | 'down' | 'stable';

export type LLMPhaseMode = 'exploratory' | 'stabilizing' | 'governed';

// ============================================================================
// PR2B: Governed LLM Overlay (Non-authoritative Artifact)
// ============================================================================

export type EvidenceRefV1 = {
	document_id: string;
	page_index: number;
	dpu_id?: string;
	block_id?: string;
	char_range?: [number, number];
};

export type GovernedLLMClaimV1 = {
	claim_type: 'kpi' | 'risk' | 'summary' | 'other';
	label: string;
	value_string?: string;
	value_number?: number;
	unit?: string;
	confidence: number; // 0..1
	evidence_refs: EvidenceRefV1[];
};

export type GovernedLLMOverviewV1 = {
	schema_version: 'governed_llm_overview_v1';
	deal_id: string;
	run_id?: string;
	step_run_id?: string;
	input_hash: string;
	created_at?: string;

	llm_phase_mode: LLMPhaseMode;

	summary_text: string;
	claims: GovernedLLMClaimV1[];

	disclosures: Array<{
		code: string;
		message: string;
	}>;
};

export interface Deal {
	id: string;
	name: string;
	stage: DealStage;
	priority: DealPriority;
	llm_phase_mode: LLMPhaseMode;
	trend?: DealTrend;
	score?: number;
	owner?: string;
	lastUpdated?: string;
	evidence_ids?: string[];

	// Additive: Analysis Foundation (Fundability) — stable DTO surface for UI/API.
	fundability_v1?: FundabilityV1DTO;

	// Latest DIO metadata (derived from versioned DIO history)
	dioVersionId?: string;
	// Current DIO status/recommendation (e.g. GO/NO-GO/CONDITIONAL)
	dioStatus?: string;
	lastAnalyzedAt?: string;
	// Number of analysis runs (DIO versions) for this deal
	dioRunCount?: number;
	// Latest DIO analysis_version
	dioAnalysisVersion?: number;
}

// ============================================================================
// Analysis Foundation: Fundability (V1)
// ============================================================================

export type FundabilityCompanyPhaseV1 =
	| 'IDEA'
	| 'PRE_SEED'
	| 'SEED'
	| 'SEED_PLUS'
	| 'SERIES_A'
	| 'SERIES_B';

export type FundabilityGateOutcomeV1 = 'PASS' | 'CONDITIONAL' | 'FAIL';

export interface FundabilityPhaseInferenceV1DTO {
	company_phase: FundabilityCompanyPhaseV1;
	confidence: number;
	supporting_evidence?: Array<{ signal: string; source?: string; note?: string }>;
	missing_evidence?: string[];
	rationale?: string[];
}

export interface FundabilityAssessmentV1DTO {
	outcome: FundabilityGateOutcomeV1;
	reasons?: string[];
	legacy_overall_score_0_100?: number | null;
	fundability_score_0_100?: number | null;
	caps?: { max_fundability_score_0_100?: number };
	fundable_at_phase_if_downgraded?: FundabilityCompanyPhaseV1;
}

export interface FundabilityDecisionV1DTO {
	outcome: FundabilityGateOutcomeV1;
	should_block_investment: boolean;
	missing_required_signals?: string[];
	next_requests?: string[];
}

export interface FundabilityV1DTO {
	// Version string from the authoritative analysis-foundation spec_versions.
	spec_version?: string;
	phase_inference_v1?: FundabilityPhaseInferenceV1DTO;
	fundability_assessment_v1?: FundabilityAssessmentV1DTO;
	fundability_decision_v1?: FundabilityDecisionV1DTO;
}

export interface DealListItem extends Deal {
	completeness?: number;
	fundingTarget?: string;
	documents?: number;
	views?: number;
}

export type DocumentType =
	| 'pitch_deck'
	| 'financials'
	| 'product'
	| 'legal'
	| 'team'
	| 'market'
	| 'other';

export type DocumentStatus =
	| 'pending'
	| 'processing'
	| 'ready_for_analysis'
	| 'completed'
	| 'needs_ocr'
	| 'failed'
	| 'rejected'
	| 'needs_review';

export interface Document {
	document_id: string;
	deal_id: string;
	type: DocumentType;
	status: DocumentStatus;
	title: string;
	uploaded_at?: string;
	evidence_ids?: string[];
}

export type JobType =
	| 'ingest_documents'
	| 'render_document_pages'
	| 'extract_visuals'
	| 'extract_visuals_deal'
	| 'populate_document_page_understanding'
	| 'deep_scan_visuals'
	| 'document_intelligence_extract'
	| 'fetch_evidence'
	| 'analyze_deal'
	| 'verify_documents'
	| 'remediate_extraction'
	| 'reextract_documents'
	| 'generate_report'
	| 'sync_crm'
	| 'classify_document'
	| 'investor_insights'
	| 'export_report_pdf';

// BullMQ queue names. Keep these centralized so API + worker stay in sync.
export const QUEUE_NAMES = {
	ingest_documents: 'ingest_documents',
	render_document_pages: 'render_document_pages',
	extract_visuals: 'extract_visuals',
	deep_scan_visuals: 'deep_scan_visuals',
	document_intelligence_extract: 'document_intelligence_extract',
	fetch_evidence: 'fetch_evidence',
	analyze_deal: 'analyze_deal',
	verify_documents: 'verify_documents',
	remediate_extraction: 'remediate_extraction',
	reextract_documents: 'reextract_documents',
	populate_document_page_understanding: 'populate_document_page_understanding',
	investor_insights: 'investor_insights',
	export_report_pdf: 'export_report_pdf',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type JobProgressStage =
	| 'queued'
	| 'fetch_original_bytes'
	| 'extract_text'
	| 'persist_document'
	| 'render_pages'
	| 'collect_image_uris'
	| 'extract_visual_assets'
	| 'deep_scan_visuals'
	| 'ocr'
	| 'classify_visuals'
	| 'persist_visual_assets'
	| 'persist_visual_extractions'
	| 'finalize'
	| 'blocked'
	| 'error';

export interface JobProgressEventV1 {
	job_id: string;
	deal_id?: string;
	document_id?: string;
	stage: JobProgressStage;
	percent?: number;
	completed?: number;
	total?: number;
	message?: string;
	reason?: string;
	meta?: Record<string, unknown>;
	at?: string;
	status?: JobStatus;
	type?: JobType;
}

export interface JobStatusDetail {
	progress?: JobProgressEventV1;
}

export type JobStatus =
	| 'queued'
	| 'running'
	| 'succeeded'
	| 'succeeded_with_warnings'
	| 'failed'
	| 'cancelled'
	| 'retrying';

export interface Job {
	job_id: string;
	type: JobType;
	status: JobStatus;
	deal_id?: string;
	document_id?: string;
	created_at?: string;
	updated_at?: string;
	started_at?: string | null;
	status_detail?: JobStatusDetail | null;
	evidence_ids?: string[];
}

export interface EvidenceItem {
	evidence_id: string;
	source: string;
	kind: 'fact' | 'metric' | 'quote' | 'document' | 'other';
	text: string;
	document_id?: string;
	created_at?: string;
	confidence?: number;
	excerpt?: string;
}

export type EvidenceMap = Record<string, EvidenceItem>;

export interface Claim {
	claim_id: string;
	claim_type: 'thesis' | 'risk' | 'metric' | 'fact' | 'recommendation';
	text: string;
	confidence?: number;
	dimension?: 'market' | 'team' | 'financial' | 'risk' | 'competition' | 'product';
	evidence_ids?: string[];
}

export interface DIOVersionMeta {
	dio_version_id: string;
	deal_id: string;
	version: number;
	status: 'draft' | 'active' | 'archived';
	created_at: string;
	created_by?: string;
	parent_version_id?: string;
	summary?: string;
	evidence_ids?: string[];
}

export interface DIOPayload {
	meta: DIOVersionMeta;
	deal: Deal;
	documents: Document[];
	evidence: EvidenceMap;
	claims: Claim[];
}

export interface ReportSection {
	id: string;
	title: string;
	content: string;
	evidence_ids?: string[];
	metrics?: Array<{ label: string; value: string | number; evidence_ids?: string[] }>;
}

export interface ReportDTO {
	report_id: string;
	deal_id: string;
	dio_version_id: string;
	generated_at: string;
	sections: ReportSection[];
	summary?: string;
	recommendation?: 'strong_yes' | 'yes' | 'consider' | 'pass';
	evidence_ids?: string[];
}

export type ChatRole = 'user' | 'assistant' | 'system';

// ============================================================================
// Scoring Input Contract (V0)
// ============================================================================

// V0 goal: provide a stable, auditable input surface for scoring regardless of
// document type (PDF/DOCX/PPTX/images/etc). Higher-level analyzers can derive
// domain-specific signals from these items, while retaining citations.

export type ScoringSourceKindV0 = 'structured_native' | 'ocr' | 'hybrid' | 'unknown';

export type ScoringItemKindV0 =
	| 'deal'
	| 'document'
	| 'page'
	| 'slide'
	| 'table'
	| 'chart'
	| 'text_block'
	| 'image'
	| 'unknown';

export interface ScoringEvidenceLocatorV0 {
	document_id: string;
	page_index?: number | null;
	page_label?: string;
	visual_asset_id?: string;
	bbox?: unknown;
	image_uri?: string | null;
}

export interface ScoringSegmentProvenanceV0 {
	effective?: string;
	computed?: string;
	persisted?: string;
	is_ocr_hint?: boolean;
}

export interface ScoringContentItemV0 {
	// Stable id (prefer lineage node_id if available)
	id: string;
	kind: ScoringItemKindV0;
	source: ScoringSourceKindV0;

	document_id?: string;
	page_index?: number | null;
	title?: string;

	// Canonical extracted representation for scoring (best-effort).
	text?: string;
	structured_json?: unknown;
	confidence?: number | null;

	segment?: ScoringSegmentProvenanceV0;
	evidence_snippets?: string[];
	locators: ScoringEvidenceLocatorV0[];

	// Optional metadata passthrough (safe for forward evolution).
	meta?: Record<string, unknown>;
}

export interface DealScoringInputV0 {
	deal_id: string;
	generated_at: string;
	items: ScoringContentItemV0[];
	warnings?: string[];
}

export interface ChatMessage {
	id: string;
	role: ChatRole;
	content: string;
	evidence_ids?: string[];
}

export type ChatAction =
	| { type: 'run_analysis'; deal_id: string; focus?: string }
	| { type: 'fetch_evidence'; deal_id: string; filter?: string }
	| { type: 'fetch_dio'; deal_id: string; dio_version_id?: string }
	| { type: 'generate_report'; deal_id: string; dio_version_id?: string }
	| { type: 'summarize_evidence'; evidence_ids: string[] };

export interface ChatCitation {
	evidence_id: string;
	excerpt?: string;
}

export interface WorkspaceChatResponse {
	reply: string;
	suggested_actions?: ChatAction[];
}

export interface DealChatResponse {
	reply: string;
	citations?: ChatCitation[];
	suggested_actions?: ChatAction[];
}

// ============================================================================
// DealChatV1 — Governed Chat with Grounded Context
// ============================================================================

export interface DealChatRequestV1 {
	message: string;
	deal_id: string;
	dio_version_id?: string | null;
}

export interface DealChatSourceV1 {
	evidence_id: string;
	page?: number;
	excerpt?: string;
}

/**
 * Typed action union for DealChatV1 — no mutation, read/navigate only.
 */
export type DealChatActionV1 =
	| { type: 'RUN_ANALYZE'; deal_id: string; payload?: { require_page_understanding?: boolean } }
	| { type: 'REGENERATE_INSIGHTS'; deal_id: string; payload?: Record<string, never> }
	| { type: 'OPEN_FULL_REPORT'; deal_id: string; payload?: { view?: string } }
	| { type: 'SHOW_SOURCES'; payload?: Record<string, never> }
	| { type: 'EXPORT_PDF'; deal_id: string; payload?: { preset?: string } };

export interface DealChatResponseV1 {
	message: string;
	confidence: 'high' | 'medium' | 'low';
	sources?: DealChatSourceV1[];
	suggested_actions?: DealChatActionV1[];
	/** Which data source grounded the answer — for observability/eval */
	answer_basis?: 'product_profile_v1' | 'orchestrator_report' | 'evidence_only' | 'insufficient_data';
	/** Fields the model acknowledged as unknown — extracted from product_profile_v1 (max 3) */
	unknowns_used?: string[];
}

// HRM-DD Analysis Types
export interface AnalysisRequest {
	deal_id: string;
	max_cycles?: number;
	force_restart?: boolean;
	analysis_mode?: 'full' | 'targeted' | 'verification';
}

export interface AnalysisProgress {
	deal_id: string;
	current_cycle: number;
	total_cycles_planned: number;
	status: 'starting' | 'cycle_1' | 'cycle_2' | 'cycle_3' | 'synthesizing' | 'completed' | 'failed';
	facts_extracted: number;
	uncertainties_identified: number;
	progress_percent: number;
}

export interface AnalysisResult {
	deal_id: string;
	analysis_id: string;
	cycles_completed: number;
	decision_recommendation: 'GO' | 'NO-GO' | 'CONDITIONAL';
	executive_summary: string;
	key_findings: string[];
	risks_identified: string[];
	next_steps: string[];
	confidence_score: number;
	completed_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Export — shared client/server contract
// ─────────────────────────────────────────────────────────────────────────────

/** Keys that map to renderable sections in the due-diligence report. */
export type ReportExportSectionKey =
	| 'decision_overlay'
	| 'executive_summary'
	| 'deal_terms'
	| 'market_analysis'
	| 'financial_analysis'
	| 'risk_verification'
	| 'evidence_appendix';

export type ReportExportPreset = 'complete' | 'investor' | 'quick' | 'custom';
export type ReportExportFormat = 'standard' | 'pdf' | 'word';

/**
 * UI-driven configuration for a server-side PDF export.
 * Sent as the POST body to /api/v1/deals/:dealId/report/export-pdf.
 * Must exactly match the shape kept in ReportGeneratorPreviewSplit (web).
 */
export interface ReportExportConfig {
	preset: ReportExportPreset;
	format: ReportExportFormat;
	sections: ReportExportSectionKey[];
	includeCoverPage?: boolean;
	includePageNumbers?: boolean;
}

/** BullMQ job payload for the export_report_pdf worker job. */
export interface ReportExportJobPayload {
	deal_id: string;
	export_id: string;       // UUID from deal_report_exports.id
	config: ReportExportConfig;
	requested_by?: string | null;
}

/** API response for POST /api/v1/deals/:dealId/report/export-pdf */
export interface ExportPdfResponse {
	ok: true;
	export_id: string;
	job_id: string | null;
	status: 'pending';
}

/** API response for GET /api/v1/deals/:dealId/report/export-pdf/:exportId */
export type ExportPdfStatusResponse =
	| { status: 'pending' | 'processing' }
	| { status: 'completed'; download_url: string; r2_key: string }
	| { status: 'failed'; error_message: string | null };

