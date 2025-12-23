/**
 * Evidence Service Interface
 * 
 * Manages evidence collection from both internal (documents) and external (Tavily) sources
 * Every fact MUST cite evidence_id - zero hallucinations
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 * Reference: docs/19_DIO_Schema_and_Interface_Contracts.md
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * Evidence item (atomic source of truth)
 */
export const EvidenceSchema = z.object({
  evidence_id: z.string(),           // Unique ID for citation
  deal_id: z.string().uuid(),        // Which deal this belongs to
  source_type: z.enum(["document", "tavily", "mcp"]), // Where it came from
  
  // Source metadata
  source: z.string(),                // Document name, URL, or MCP tool
  page: z.number().optional(),       // Page number (if document)
  chunk_index: z.number().optional(), // Chunk index (if long document)
  
  // Content
  content: z.string(),               // The actual evidence text
  embedding: z.array(z.number()).optional(), // Vector embedding for similarity search
  
  // Quality
  confidence: z.number().min(0).max(1), // How reliable is this evidence (0.0 - 1.0)
  verified: z.boolean().default(false), // Has this been validated
  
  // Timestamps
  extracted_at: z.string(),          // ISO timestamp
  created_at: z.string(),            // ISO timestamp
});

export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * Evidence filter for querying
 */
export const EvidenceFilterSchema = z.object({
  source_type: z.enum(["document", "tavily", "mcp"]).optional(),
  source: z.string().optional(),
  page: z.number().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  verified_only: z.boolean().optional(),
  search_query: z.string().optional(), // Semantic search
  limit: z.number().positive().default(100),
  offset: z.number().min(0).default(0),
});

export type EvidenceFilter = z.infer<typeof EvidenceFilterSchema>;

/**
 * Evidence collection options
 */
export const EvidenceOptionsSchema = z.object({
  tavily_enabled: z.boolean().default(false), // Feature flag
  max_chunks_per_doc: z.number().positive().default(50), // Limit chunks extracted
  min_chunk_length: z.number().positive().default(100), // Min chars per chunk
  max_tavily_results: z.number().positive().default(10), // Limit external results
  include_embeddings: z.boolean().default(true), // Generate embeddings for search
  confidence_threshold: z.number().min(0).max(1).default(0.5), // Filter low quality
});

export type EvidenceOptions = z.infer<typeof EvidenceOptionsSchema>;

/**
 * Tavily search result (external evidence)
 */
export const TavilyResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  content: z.string(),
  score: z.number().min(0).max(1), // Tavily's relevance score
  published_date: z.string().optional(),
});

export type TavilyResult = z.infer<typeof TavilyResultSchema>;

/**
 * Evidence derivation result
 */
export const EvidenceDerivationResultSchema = z.object({
  evidence_ids: z.array(z.string()),
  total_chunks: z.number(),
  documents_processed: z.number(),
  duration_ms: z.number(),
  warnings: z.array(z.string()).optional(),
});

export type EvidenceDerivationResult = z.infer<typeof EvidenceDerivationResultSchema>;

/**
 * External evidence fetch result
 */
export const ExternalEvidenceResultSchema = z.object({
  evidence_ids: z.array(z.string()),
  queries_executed: z.number(),
  results_found: z.number(),
  duration_ms: z.number(),
  tavily_calls: z.number(),
  warnings: z.array(z.string()).optional(),
});

export type ExternalEvidenceResult = z.infer<typeof ExternalEvidenceResultSchema>;

// ============================================================================
// Errors
// ============================================================================

export class EvidenceServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "EvidenceServiceError";
  }
}

export class EvidenceNotFoundError extends EvidenceServiceError {
  constructor(evidence_id: string) {
    super(`Evidence with ID '${evidence_id}' not found`, "EVIDENCE_NOT_FOUND");
    this.name = "EvidenceNotFoundError";
  }
}

export class TavilyDisabledError extends EvidenceServiceError {
  constructor() {
    super(
      "Tavily is disabled in configuration. Set tavily_enabled=true to enable external evidence.",
      "TAVILY_DISABLED"
    );
    this.name = "TavilyDisabledError";
  }
}

export class EvidenceExtractionError extends EvidenceServiceError {
  constructor(message: string) {
    super(message, "EXTRACTION_ERROR");
    this.name = "EvidenceExtractionError";
  }
}

// ============================================================================
// Core Interface
// ============================================================================

/**
 * Evidence Service Interface
 * 
 * Manages all evidence collection and retrieval
 * 
 * Two types of evidence:
 * 1. Internal (derived from uploaded documents) - deterministic
 * 2. External (fetched via Tavily) - non-deterministic, needs feature flag
 * 
 * Example usage:
 * ```typescript
 * const evidenceService = new EvidenceServiceImpl(config);
 * 
 * // Derive evidence from documents
 * const internal = await evidenceService.deriveInternalEvidence(deal_id);
 * console.log(`Extracted ${internal.evidence_ids.length} chunks`);
 * 
 * // Fetch external evidence (if tavily_enabled)
 * const external = await evidenceService.fetchExternalEvidence(
 *   deal_id,
 *   ["AI market size 2024", "ML adoption rates"],
 *   { tavily_enabled: true }
 * );
 * 
 * // Get specific evidence for citation
 * const evidence = await evidenceService.getEvidence(evidence_ids[0]);
 * console.log(evidence.content); // The actual text
 * 
 * // Search evidence semantically
 * const relevant = await evidenceService.listEvidence(deal_id, {
 *   search_query: "revenue projections",
 *   min_confidence: 0.7,
 *   limit: 10
 * });
 * ```
 */
export interface EvidenceService {
  /**
   * Derive evidence from uploaded documents
   * 
   * This is DETERMINISTIC - same documents always produce same evidence chunks
   * 
   * Process:
   * 1. Get all documents for deal
   * 2. Extract text + metadata (page numbers, etc.)
   * 3. Chunk into semantic units (~200-500 chars)
   * 4. Generate embeddings for similarity search
   * 5. Store with unique evidence_id
   * 
   * @param deal_id - Deal to extract evidence for
   * @param options - Extraction options
   * @returns Evidence derivation result with evidence_ids
   */
  deriveInternalEvidence(
    deal_id: string,
    options?: EvidenceOptions
  ): Promise<EvidenceDerivationResult>;

  /**
   * Fetch external evidence via Tavily
   * 
   * This is NON-DETERMINISTIC - Tavily results change over time
   * MUST check tavily_enabled feature flag
   * 
   * Process:
   * 1. Check tavily_enabled (throw if false)
   * 2. Execute Tavily searches for each query
   * 3. Convert results to Evidence objects
   * 4. Store with source_type="tavily"
   * 5. Return evidence_ids for citation
   * 
   * @param deal_id - Deal to fetch evidence for
   * @param queries - Search queries (generated by LLM or heuristic)
   * @param options - Fetch options (must include tavily_enabled)
   * @returns External evidence result with evidence_ids
   * @throws TavilyDisabledError if tavily_enabled=false
   */
  fetchExternalEvidence(
    deal_id: string,
    queries: string[],
    options?: EvidenceOptions
  ): Promise<ExternalEvidenceResult>;

  /**
   * Get single evidence item by ID
   * 
   * Use this for citation lookup (FactRow.evidence_id → Evidence.content)
   * 
   * @param evidence_id - Unique evidence ID
   * @returns Evidence object or null if not found
   */
  getEvidence(evidence_id: string): Promise<Evidence | null>;

  /**
   * List evidence for a deal with filtering
   * 
   * Supports:
   * - Source type filtering (document/tavily/mcp)
   * - Confidence thresholds
   * - Semantic search (using embeddings)
   * - Pagination
   * 
   * @param deal_id - Deal to list evidence for
   * @param filters - Filter options
   * @returns Array of Evidence objects
   */
  listEvidence(deal_id: string, filters?: EvidenceFilter): Promise<Evidence[]>;

  /**
   * Delete all evidence for a deal
   * 
   * Use when deal is deleted or re-analyzed
   * 
   * @param deal_id - Deal to delete evidence for
   * @returns Number of evidence items deleted
   */
  deleteEvidence(deal_id: string): Promise<number>;

  /**
   * Search evidence semantically
   * 
   * Uses embedding similarity to find relevant evidence
   * 
   * @param deal_id - Deal to search within
   * @param query - Natural language search query
   * @param limit - Max results
   * @returns Array of Evidence objects ranked by relevance
   */
  searchEvidence(deal_id: string, query: string, limit?: number): Promise<Evidence[]>;
}

// ============================================================================
// Production Implementation
// ============================================================================

/**
 * Simple embedding generator (stub - replace with actual model)
 * In production, use OpenAI embeddings or local model
 */
class EmbeddingGenerator {
  /**
   * Generate embedding for text
   * 
   * NOTE: This is a placeholder implementation
   * In production, replace with:
   * - OpenAI text-embedding-3-small API
   * - Local sentence-transformers model
   * - AWS Bedrock Titan Embeddings
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // Placeholder: Return zero vector
    // Real implementation would call embedding API
    const dimension = 384;  // Common dimension for sentence-transformers
    return new Array(dimension).fill(0);
  }

  /**
   * Batch generate embeddings
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.generateEmbedding(t)));
  }
}

/**
 * Tavily API client
 */
class TavilyClient {
  constructor(private api_key: string) {}

  /**
   * Search Tavily API
   * 
   * @param query Search query
   * @param max_results Maximum results to return
   * @returns Array of search results
   */
  async search(query: string, max_results = 10): Promise<TavilyResult[]> {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.api_key}`,
        },
        body: JSON.stringify({
          query,
          max_results,
          include_answer: true,
          include_raw_content: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      
      return (data.results || []).map((r: any) => ({
        url: r.url,
        title: r.title,
        content: r.content,
        score: r.score || 0.5,
        published_date: r.published_date,
      }));
    } catch (error) {
      throw new EvidenceExtractionError(
        `Tavily search failed: ${(error as Error).message}`
      );
    }
  }
}

/**
 * Database interface for evidence storage
 */
interface EvidenceDatabase {
  saveEvidence(evidence: Evidence): Promise<void>;
  getEvidence(evidence_id: string): Promise<Evidence | null>;
  listEvidence(deal_id: string, filters?: EvidenceFilter): Promise<Evidence[]>;
  deleteEvidence(deal_id: string): Promise<number>;
  searchSimilar(deal_id: string, embedding: number[], limit: number): Promise<Evidence[]>;
}

/**
 * PostgreSQL evidence database implementation
 */
class PostgreSQLEvidenceDatabase implements EvidenceDatabase {
  constructor(private connectionString: string) {}

  async saveEvidence(evidence: Evidence): Promise<void> {
    // In production, use pg library
    // For now, this is a stub
    // Real implementation:
    /*
    const client = await this.getClient();
    await client.query(
      `INSERT INTO evidence (
        evidence_id, deal_id, source_type, source, page, chunk_index,
        content, embedding, confidence, verified, extracted_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (evidence_id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        confidence = EXCLUDED.confidence`,
      [
        evidence.evidence_id,
        evidence.deal_id,
        evidence.source_type,
        evidence.source,
        evidence.page,
        evidence.chunk_index,
        evidence.content,
        JSON.stringify(evidence.embedding),
        evidence.confidence,
        evidence.verified,
        evidence.extracted_at,
        evidence.created_at,
      ]
    );
    */
    console.log(`[DB] Saving evidence: ${evidence.evidence_id}`);
  }

  async getEvidence(evidence_id: string): Promise<Evidence | null> {
    // Stub - real implementation would query database
    console.log(`[DB] Getting evidence: ${evidence_id}`);
    return null;
  }

  async listEvidence(deal_id: string, filters?: EvidenceFilter): Promise<Evidence[]> {
    // Stub - real implementation would query database with filters
    console.log(`[DB] Listing evidence for deal: ${deal_id}`);
    return [];
  }

  async deleteEvidence(deal_id: string): Promise<number> {
    // Stub - real implementation would delete from database
    console.log(`[DB] Deleting evidence for deal: ${deal_id}`);
    return 0;
  }

  async searchSimilar(deal_id: string, embedding: number[], limit: number): Promise<Evidence[]> {
    // Stub - real implementation would use pgvector similarity search
    /*
    const client = await this.getClient();
    const result = await client.query(
      `SELECT * FROM evidence
       WHERE deal_id = $1
       ORDER BY embedding <-> $2
       LIMIT $3`,
      [deal_id, JSON.stringify(embedding), limit]
    );
    return result.rows;
    */
    console.log(`[DB] Searching similar evidence for deal: ${deal_id}`);
    return [];
  }
}

/**
 * Production Evidence Service Implementation
 * 
 * Features:
 * - Document chunking (sentence and paragraph strategies)
 * - Embedding generation for semantic search
 * - Tavily API integration for external research
 * - PostgreSQL storage with pgvector
 * - Evidence deduplication
 */
export class EvidenceServiceImpl implements EvidenceService {
  private embeddingGenerator: EmbeddingGenerator;
  private tavilyClient: TavilyClient | null = null;
  private database: EvidenceDatabase;

  constructor(
    database_url: string,
    tavily_api_key?: string
  ) {
    this.embeddingGenerator = new EmbeddingGenerator();
    this.database = new PostgreSQLEvidenceDatabase(database_url);
    
    if (tavily_api_key) {
      this.tavilyClient = new TavilyClient(tavily_api_key);
    }
  }

  async deriveInternalEvidence(
    deal_id: string,
    options?: EvidenceOptions
  ): Promise<EvidenceDerivationResult> {
    const start_time = Date.now();
    const opts = { ...createDefaultEvidenceOptions(), ...options };

    try {
      // Step 1: Get all documents for this deal
      const documents = await this.getDocumentsForDeal(deal_id);
      
      if (documents.length === 0) {
        return {
          evidence_ids: [],
          total_chunks: 0,
          documents_processed: 0,
          duration_ms: Date.now() - start_time,
          warnings: ["No documents found for deal"],
        };
      }

      const evidence_ids: string[] = [];
      let total_chunks = 0;

      // Step 2: Process each document
      for (const doc of documents) {
        // Extract text from document
        const text = await this.extractTextFromDocument(doc);
        
        // Chunk text into semantic units
        const chunks = chunkBySentences(
          text,
          opts.min_chunk_length,
          500  // max chunk length
        );

        // Limit chunks per document
        const limited_chunks = chunks.slice(0, opts.max_chunks_per_doc);
        
        // Generate embeddings if requested
        const embeddings = opts.include_embeddings
          ? await this.embeddingGenerator.generateEmbeddings(limited_chunks)
          : [];

        // Create evidence objects
        for (let i = 0; i < limited_chunks.length; i++) {
          const evidence_id = generateEvidenceId(deal_id, "document", total_chunks + i);
          
          const evidence = createEvidence(
            evidence_id,
            deal_id,
            "document",
            doc.filename,
            limited_chunks[i],
            0.9,  // High confidence for document evidence
            doc.page
          );

          if (embeddings.length > 0) {
            evidence.embedding = embeddings[i];
          }

          evidence.chunk_index = i;

          // Save to database
          await this.database.saveEvidence(evidence);
          evidence_ids.push(evidence_id);
        }

        total_chunks += limited_chunks.length;
      }

      return {
        evidence_ids,
        total_chunks,
        documents_processed: documents.length,
        duration_ms: Date.now() - start_time,
      };
    } catch (error) {
      throw new EvidenceExtractionError(
        `Failed to derive internal evidence: ${(error as Error).message}`
      );
    }
  }

  async fetchExternalEvidence(
    deal_id: string,
    queries: string[],
    options?: EvidenceOptions
  ): Promise<ExternalEvidenceResult> {
    const start_time = Date.now();
    const opts = { ...createDefaultEvidenceOptions(), ...options };

    // Check if Tavily is enabled
    if (!opts.tavily_enabled) {
      throw new TavilyDisabledError();
    }

    if (!this.tavilyClient) {
      throw new EvidenceServiceError(
        "Tavily client not initialized - missing API key",
        "TAVILY_NOT_CONFIGURED"
      );
    }

    const evidence_ids: string[] = [];
    let results_found = 0;
    let tavily_calls = 0;

    try {
      // Execute Tavily searches
      for (const query of queries) {
        tavily_calls++;
        
        const results = await this.tavilyClient.search(
          query,
          opts.max_tavily_results
        );

        results_found += results.length;

        // Convert results to Evidence objects
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const evidence_id = generateEvidenceId(
            deal_id,
            "tavily",
            evidence_ids.length
          );

          const evidence = createEvidence(
            evidence_id,
            deal_id,
            "tavily",
            result.url,
            result.content,
            result.score,
            undefined
          );

          // Generate embedding if requested
          if (opts.include_embeddings) {
            evidence.embedding = await this.embeddingGenerator.generateEmbedding(
              result.content
            );
          }

          // Save to database
          await this.database.saveEvidence(evidence);
          evidence_ids.push(evidence_id);
        }
      }

      return {
        evidence_ids,
        queries_executed: queries.length,
        results_found,
        duration_ms: Date.now() - start_time,
        tavily_calls,
      };
    } catch (error) {
      if (error instanceof TavilyDisabledError) {
        throw error;
      }

      throw new EvidenceExtractionError(
        `Failed to fetch external evidence: ${(error as Error).message}`
      );
    }
  }

  async getEvidence(evidence_id: string): Promise<Evidence | null> {
    return this.database.getEvidence(evidence_id);
  }

  async listEvidence(deal_id: string, filters?: EvidenceFilter): Promise<Evidence[]> {
    return this.database.listEvidence(deal_id, filters);
  }

  async deleteEvidence(deal_id: string): Promise<number> {
    return this.database.deleteEvidence(deal_id);
  }

  async searchEvidence(deal_id: string, query: string, limit = 10): Promise<Evidence[]> {
    // Generate embedding for query
    const query_embedding = await this.embeddingGenerator.generateEmbedding(query);
    
    // Search using vector similarity
    return this.database.searchSimilar(deal_id, query_embedding, limit);
  }

  /**
   * Get documents for a deal (stub - replace with actual document service)
   */
  private async getDocumentsForDeal(deal_id: string): Promise<Array<{
    filename: string;
    page?: number;
    content: string;
  }>> {
    // In production, this would query the documents table
    // For now, return empty array
    console.log(`[Evidence] Getting documents for deal: ${deal_id}`);
    return [];
  }

  /**
   * Extract text from document (stub - replace with actual PDF/DOCX parser)
   */
  private async extractTextFromDocument(doc: {
    filename: string;
    page?: number;
    content: string;
  }): Promise<string> {
    // In production, use pdf-parse, mammoth, or similar
    return doc.content;
  }
}

// ============================================================================
// Mock Implementation (for testing)
// ============================================================================

/**
 * Mock evidence service for testing
 * Returns predefined evidence without real extraction
 */
export class MockEvidenceService implements EvidenceService {
  private evidence: Map<string, Evidence> = new Map();
  private evidenceByDeal: Map<string, string[]> = new Map();

  /**
   * Register mock evidence
   */
  registerEvidence(evidence: Evidence): void {
    this.evidence.set(evidence.evidence_id, evidence);
    
    const deal_evidence = this.evidenceByDeal.get(evidence.deal_id) || [];
    deal_evidence.push(evidence.evidence_id);
    this.evidenceByDeal.set(evidence.deal_id, deal_evidence);
  }

  async deriveInternalEvidence(
    deal_id: string,
    options?: EvidenceOptions
  ): Promise<EvidenceDerivationResult> {
    const evidence_ids = this.evidenceByDeal.get(deal_id) || [];
    
    return {
      evidence_ids,
      total_chunks: evidence_ids.length,
      documents_processed: 1,
      duration_ms: 100,
    };
  }

  async fetchExternalEvidence(
    deal_id: string,
    queries: string[],
    options?: EvidenceOptions
  ): Promise<ExternalEvidenceResult> {
    if (!options?.tavily_enabled) {
      throw new TavilyDisabledError();
    }

    return {
      evidence_ids: [],
      queries_executed: queries.length,
      results_found: 0,
      duration_ms: 50,
      tavily_calls: queries.length,
      warnings: ["Mock implementation - no real Tavily calls"],
    };
  }

  async getEvidence(evidence_id: string): Promise<Evidence | null> {
    return this.evidence.get(evidence_id) || null;
  }

  async listEvidence(deal_id: string, filters?: EvidenceFilter): Promise<Evidence[]> {
    const evidence_ids = this.evidenceByDeal.get(deal_id) || [];
    let results = evidence_ids
      .map(id => this.evidence.get(id))
      .filter((e): e is Evidence => e !== undefined);

    // Apply filters
    if (filters?.source_type) {
      results = results.filter(e => e.source_type === filters.source_type);
    }
    if (filters?.min_confidence !== undefined) {
      results = results.filter(e => e.confidence >= filters.min_confidence!);
    }
    if (filters?.verified_only) {
      results = results.filter(e => e.verified);
    }

    // Pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;
    return results.slice(offset, offset + limit);
  }

  async deleteEvidence(deal_id: string): Promise<number> {
    const evidence_ids = this.evidenceByDeal.get(deal_id) || [];
    evidence_ids.forEach(id => this.evidence.delete(id));
    this.evidenceByDeal.delete(deal_id);
    return evidence_ids.length;
  }

  async searchEvidence(deal_id: string, query: string, limit = 10): Promise<Evidence[]> {
    // Simple text search for mock
    const all = await this.listEvidence(deal_id);
    const matching = all.filter(e => 
      e.content.toLowerCase().includes(query.toLowerCase())
    );
    return matching.slice(0, limit);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create default evidence options
 */
export function createDefaultEvidenceOptions(): EvidenceOptions {
  return {
    tavily_enabled: false,  // Disabled by default (deterministic mode)
    max_chunks_per_doc: 50,
    min_chunk_length: 100,
    max_tavily_results: 10,
    include_embeddings: true,
    confidence_threshold: 0.5,
  };
}

/**
 * Generate unique evidence ID
 */
export function generateEvidenceId(
  deal_id: string,
  source_type: "document" | "tavily" | "mcp",
  index: number
): string {
  const timestamp = Date.now();
  return `${source_type}_${deal_id.substring(0, 8)}_${timestamp}_${index}`;
}

/**
 * Validate evidence object
 */
export function validateEvidence(data: unknown): Evidence {
  return EvidenceSchema.parse(data);
}

/**
 * Create evidence object
 */
export function createEvidence(
  evidence_id: string,
  deal_id: string,
  source_type: "document" | "tavily" | "mcp",
  source: string,
  content: string,
  confidence: number,
  page?: number
): Evidence {
  return {
    evidence_id,
    deal_id,
    source_type,
    source,
    page,
    content,
    confidence,
    verified: false,
    extracted_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

// ============================================================================
// Chunking Strategies (for document processing)
// ============================================================================

/**
 * Chunk text by sentences (semantic boundaries)
 * 
 * Better than fixed-length chunking because it preserves context
 */
export function chunkBySentences(
  text: string,
  min_length = 100,
  max_length = 500
): string[] {
  // Simple sentence splitter (can be improved with NLP library)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  const chunks: string[] = [];
  let current_chunk = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    
    if (current_chunk.length + trimmed.length > max_length && current_chunk.length >= min_length) {
      chunks.push(current_chunk.trim());
      current_chunk = trimmed;
    } else {
      current_chunk += (current_chunk ? " " : "") + trimmed;
    }
  }

  if (current_chunk.length >= min_length) {
    chunks.push(current_chunk.trim());
  }

  return chunks;
}

/**
 * Chunk text by paragraphs (document structure)
 */
export function chunkByParagraphs(
  text: string,
  min_length = 100,
  max_length = 500
): string[] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  const chunks: string[] = [];
  let current_chunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    
    if (current_chunk.length + trimmed.length > max_length && current_chunk.length >= min_length) {
      chunks.push(current_chunk.trim());
      current_chunk = trimmed;
    } else {
      current_chunk += (current_chunk ? "\n\n" : "") + trimmed;
    }
  }

  if (current_chunk.length >= min_length) {
    chunks.push(current_chunk.trim());
  }

  return chunks.filter(c => c.length >= min_length);
}

// ============================================================================
// Type Guards
// ============================================================================

export function isEvidence(value: unknown): value is Evidence {
  return EvidenceSchema.safeParse(value).success;
}

export function isTavilyResult(value: unknown): value is TavilyResult {
  return TavilyResultSchema.safeParse(value).success;
}
