export type DocumentType = 
  | 'executive'
  | 'pitch'
  | 'financial'
  | 'market'
  | 'competitive'
  | 'business'
  | 'team'
  | 'risk';

export type DocumentStatus = 'not_started' | 'draft' | 'uploaded' | 'complete';

export interface Document {
  id: string;
  dealId: string;
  dealName: string;
  type: DocumentType;
  name: string;
  status: DocumentStatus;
  score: number | null;
  fileSize?: string;
  pages?: number;
  uploadedBy?: string;
  lastModified: string;
  version?: string;
}

export const DOCUMENT_TYPE_INFO: Record<DocumentType, { label: string; icon: string }> = {
  executive: { label: 'Executive Summary', icon: '📄' },
  pitch: { label: 'Pitch Deck', icon: '🎨' },
  financial: { label: 'Financial Model', icon: '💰' },
  market: { label: 'Market Analysis', icon: '📊' },
  competitive: { label: 'Competitive Landscape', icon: '⚔️' },
  business: { label: 'Business Plan', icon: '📋' },
  team: { label: 'Team Overview', icon: '👥' },
  risk: { label: 'Risk Register', icon: '⚠️' }
};
