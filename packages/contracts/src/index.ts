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

export interface Deal {
	id: string;
	name: string;
	stage: DealStage;
	priority: DealPriority;
	trend?: DealTrend;
	score?: number;
	owner?: string;
	lastUpdated?: string;
	evidence_ids?: string[];

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
	| 'completed'
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
	| 'extract_visuals'
	| 'fetch_evidence'
	| 'analyze_deal'
	| 'verify_documents'
	| 'remediate_extraction'
	| 'reextract_documents'
	| 'generate_report'
	| 'sync_crm'
	| 'classify_document';

export type JobProgressStage =
	| 'queued'
	| 'fetch_original_bytes'
	| 'extract_text'
	| 'persist_document'
	| 'render_pages'
	| 'collect_image_uris'
	| 'extract_visual_assets'
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

