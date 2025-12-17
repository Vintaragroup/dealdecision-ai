/**
 * Document Grouping Utility
 * Intelligently groups documents by company/deal name and detects relationships
 */

export interface DocumentFile {
  name: string;
  file: File;
  type: DocumentType;
  companyName: string;
  variant?: string; // e.g., "v2 edits", "v6", "2.png"
}

export enum DocumentType {
  PITCH_DECK = 'pitch_deck',
  BUSINESS_PLAN = 'business_plan',
  WHITEPAPER = 'whitepaper',
  FINANCIALS = 'financials',
  OTHER = 'other',
}

export interface DocumentGroup {
  companyName: string;
  dealId?: string; // If matched to existing deal
  documents: DocumentFile[];
  status: 'matched' | 'new' | 'unmatched';
  confidence: number; // 0-1, how confident we are about the grouping
}

export interface BatchAnalysisResult {
  groups: DocumentGroup[];
  unmatched: DocumentFile[];
  duplicates: {
    group: DocumentGroup;
    versions: DocumentFile[]; // Multiple versions of same doc
  }[];
}

/**
 * Extract company name from filename using common patterns
 * Examples:
 *   "PD - Vintara Group LLC - Where Culture Meets Capital.pdf" -> "Vintara Group"
 *   "Financials - WebMax Valuation and Allocation of funds.xlsx" -> "WebMax"
 *   "BP - 3ICE.pdf" -> "3ICE"
 */
export function extractCompanyName(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

  // Pattern 1: "PD - CompanyName - ..." or "BP - CompanyName - ..."
  const prefixMatch = nameWithoutExt.match(
    /^(?:PD|BP|WP|Financials)\s*-\s*([^-]+?)(?:\s*-|$)/
  );
  if (prefixMatch) {
    return prefixMatch[1].trim();
  }

  // Pattern 2: If no prefix match, try to extract before " Deck", " Fund", " Series", etc
  const contextMatch = nameWithoutExt.match(
    /^([^D]+?)(?:\s+Deck|\s+Fund|\s+Series|\s+Raise|\s+Valuation|\s+Overview)/i
  );
  if (contextMatch) {
    return contextMatch[1].trim();
  }

  // Pattern 3: Last resort - use whole filename minus common suffixes
  let result = nameWithoutExt
    .replace(/\s*(v\d+|edits?|version|v[0-9a-z]+).*$/i, '')
    .trim();

  return result || 'Unknown';
}

/**
 * Detect document type from filename and extension
 */
export function detectDocumentType(filename: string): DocumentType {
  const nameLower = filename.toLowerCase();

  if (nameLower.includes('pd -') || nameLower.includes('pitch')) {
    return DocumentType.PITCH_DECK;
  }
  if (nameLower.includes('bp -') || nameLower.includes('business plan')) {
    return DocumentType.BUSINESS_PLAN;
  }
  if (nameLower.includes('wp -') || nameLower.includes('whitepaper')) {
    return DocumentType.WHITEPAPER;
  }
  if (nameLower.includes('financials') || nameLower.includes('valuation')) {
    return DocumentType.FINANCIALS;
  }

  return DocumentType.OTHER;
}

/**
 * Detect variant/version info from filename
 * Examples: "v2 edits", "V6 (v2)", "2.png"
 */
export function extractVariant(filename: string): string | undefined {
  const variantMatch = filename.match(/(?:v\d+[a-z]?|version\s+\d+|edits?)\s*(?:\(.*\))?/i);
  return variantMatch ? variantMatch[0].trim() : undefined;
}

/**
 * Parse uploaded files and group by company
 */
export function groupDocumentsByCompany(files: File[]): DocumentFile[] {
  return files.map((file) => ({
    name: file.name,
    file,
    type: detectDocumentType(file.name),
    companyName: extractCompanyName(file.name),
    variant: extractVariant(file.name),
  }));
}

/**
 * Group documents and identify duplicates/versions
 */
export function createDocumentGroups(
  documents: DocumentFile[]
): { groups: Map<string, DocumentFile[]>; duplicates: Map<string, DocumentFile[][]> } {
  const groups = new Map<string, DocumentFile[]>();
  const duplicates = new Map<string, DocumentFile[][]>();

  // First pass: group by company
  for (const doc of documents) {
    const key = doc.companyName.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(doc);
  }

  // Second pass: detect duplicate document types within a group
  for (const [company, docs] of groups.entries()) {
    const typeGroups = new Map<DocumentType, DocumentFile[]>();
    for (const doc of docs) {
      if (!typeGroups.has(doc.type)) {
        typeGroups.set(doc.type, []);
      }
      typeGroups.get(doc.type)!.push(doc);
    }

    // If any type has multiple files, it's a duplicate set
    for (const [type, typeDocs] of typeGroups.entries()) {
      if (typeDocs.length > 1) {
        if (!duplicates.has(company)) {
          duplicates.set(company, []);
        }
        duplicates.get(company)!.push(typeDocs);
      }
    }
  }

  return { groups, duplicates };
}

/**
 * Match document groups to existing deals
 * Simple implementation: exact match on company name (case-insensitive)
 * Could be enhanced with fuzzy matching, Levenshtein distance, etc.
 */
export function matchGroupsToDealsByName(
  groups: Map<string, DocumentFile[]>,
  existingDeals: Array<{ id: string; name: string }>
): Map<string, string | null> {
  const matches = new Map<string, string | null>();

  for (const [company] of groups.entries()) {
    const match = existingDeals.find(
      (deal) => deal.name.toLowerCase() === company.toLowerCase()
    );
    matches.set(company, match?.id ?? null);
  }

  return matches;
}

/**
 * Calculate confidence score for a match
 * 0 = no match, 1 = perfect match
 */
export function calculateMatchConfidence(
  documentCompanyName: string,
  dealName: string
): number {
  const docName = documentCompanyName.toLowerCase().trim();
  const dealNameLower = dealName.toLowerCase().trim();

  if (docName === dealNameLower) {
    return 1.0; // Perfect match
  }

  // Check if one contains the other
  if (docName.includes(dealNameLower) || dealNameLower.includes(docName)) {
    return 0.85;
  }

  // Check for partial match (first words match)
  const docWords = docName.split(/\s+/);
  const dealWords = dealNameLower.split(/\s+/);
  const commonWords = docWords.filter((w) => dealWords.includes(w));
  if (commonWords.length > 0) {
    return Math.min(commonWords.length / Math.max(docWords.length, dealWords.length), 0.7);
  }

  return 0; // No match
}

/**
 * Main function: Analyze batch of files and prepare confirmation data
 */
export function analyzeBatchDocuments(
  files: File[],
  existingDeals: Array<{ id: string; name: string }>
): BatchAnalysisResult {
  const documents = groupDocumentsByCompany(files);
  const { groups, duplicates } = createDocumentGroups(documents);
  const dealMatches = matchGroupsToDealsByName(groups, existingDeals);

  const result: BatchAnalysisResult = {
    groups: [],
    unmatched: [],
    duplicates: [],
  };

  // Process each group
  for (const [company, docs] of groups.entries()) {
    const dealId = dealMatches.get(company);
    const confidence =
      dealId && existingDeals.find((d) => d.id === dealId)
        ? calculateMatchConfidence(company, existingDeals.find((d) => d.id === dealId)!.name)
        : 0;

    result.groups.push({
      companyName: company,
      dealId: dealId ?? undefined,
      documents: docs,
      status: dealId ? 'matched' : 'new',
      confidence,
    });

    // Track duplicates
    const groupDuplicates = duplicates.get(company);
    if (groupDuplicates) {
      for (const dupSet of groupDuplicates) {
        const group = result.groups.find((g) => g.companyName === company)!;
        result.duplicates.push({
          group,
          versions: dupSet,
        });
      }
    }
  }

  // Unmatched documents (shouldn't happen with our grouping, but for completeness)
  result.unmatched = documents.filter((doc) => !result.groups.some((g) => g.documents.includes(doc)));

  // Sort groups by confidence (matched first, then by confidence)
  result.groups.sort((a, b) => {
    if ((a.dealId ? 1 : 0) !== (b.dealId ? 1 : 0)) {
      return (b.dealId ? 1 : 0) - (a.dealId ? 1 : 0);
    }
    return b.confidence - a.confidence;
  });

  return result;
}

/**
 * Format company name for display
 */
export function formatCompanyName(name: string): string {
  // Capitalize words, handle special cases
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get display label for document type
 */
export function getDocumentTypeLabel(type: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    [DocumentType.PITCH_DECK]: 'Pitch Deck',
    [DocumentType.BUSINESS_PLAN]: 'Business Plan',
    [DocumentType.WHITEPAPER]: 'Whitepaper',
    [DocumentType.FINANCIALS]: 'Financial Document',
    [DocumentType.OTHER]: 'Document',
  };
  return labels[type];
}
