// Shared contracts for DealDecision AI

export type DealStage = 'idea' | 'progress' | 'ready' | 'pitched';
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
	| 'analyze_deal'
	| 'generate_report'
	| 'sync_crm'
	| 'classify_document';

export type JobStatus =
	| 'queued'
	| 'running'
	| 'succeeded'
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
	evidence_ids?: string[];
}

export interface EvidenceItem {
	evidence_id: string;
	source: string;
	kind: 'fact' | 'metric' | 'quote' | 'document' | 'other';
	text: string;
	created_at?: string;
	confidence?: number;
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
	| { type: 'fetch_dio'; deal_id: string; dio_version_id?: string }
	| { type: 'run_analysis'; deal_id: string; focus?: string }
	| { type: 'generate_report'; deal_id: string; dio_version_id?: string }
	| { type: 'summarize_evidence'; evidence_ids: string[] };

export interface ChatResponse {
	messages: ChatMessage[];
	actions?: ChatAction[];
	evidence_ids?: string[];
}
