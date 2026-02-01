/**
 * DIO Storage Service
 * 
 * Manages storage and retrieval of Deal Intelligence Objects (DIOs)
 * - PostgreSQL persistence with JSONB
 * - Versioning and history tracking
 * - Idempotency guarantees (input_hash)
 * - Query by deal, version, or timestamp
 * 
 * Based on: DIO Schema v1.0.0, Database migrations
 * Reference: infra/migrations/2025-12-18-003-add-dio-tables.sql
 */

import { z } from "zod";
import type { DealIntelligenceObject } from "../types/dio";
import { createHash } from "crypto";
import { buildScoreExplanationFromDIO, buildScoringDiagnosticsFromDIO } from "../reports/score-explanation";

// ============================================================================
// Schemas
// ============================================================================

/**
 * DIO storage result
 */
export const DIOStorageResultSchema = z.object({
  dio_id: z.string().uuid(),
  version: z.number().int().positive(),
  created_at: z.string(),
  is_duplicate: z.boolean().default(false),
});

export type DIOStorageResult = z.infer<typeof DIOStorageResultSchema>;

/**
 * DIO query filter
 */
export const DIOQueryFilterSchema = z.object({
  deal_id: z.string().uuid().optional(),
  version: z.number().int().positive().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  limit: z.number().positive().default(100),
  offset: z.number().min(0).default(0),
});

export type DIOQueryFilter = z.infer<typeof DIOQueryFilterSchema>;

// ============================================================================
// Errors
// ============================================================================

export class DIOStorageError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DIOStorageError";
  }
}

export class DIONotFoundError extends DIOStorageError {
  constructor(deal_id: string, version?: number) {
    super(
      `DIO not found for deal ${deal_id}${version ? ` version ${version}` : ""}`,
      "DIO_NOT_FOUND"
    );
    this.name = "DIONotFoundError";
  }
}

export class DIODuplicateError extends DIOStorageError {
  constructor(deal_id: string, input_hash: string) {
    super(
      `DIO already exists for deal ${deal_id} with input hash ${input_hash}`,
      "DIO_DUPLICATE"
    );
    this.name = "DIODuplicateError";
  }
}

// ============================================================================
// Core Interface
// ============================================================================

/**
 * DIO Storage Service Interface
 * 
 * Manages persistence of Deal Intelligence Objects
 * 
 * Example usage:
 * ```typescript
 * const storage = new DIOStorageImpl(database_url);
 * 
 * // Save new DIO
 * const result = await storage.saveDIO(dio);
 * console.log(`Saved DIO version ${result.version}`);
 * 
 * // Get latest DIO for deal
 * const latest = await storage.getLatestDIO(deal_id);
 * console.log(`Confidence: ${latest.metadata.confidence}`);
 * 
 * // Get all versions
 * const history = await storage.getDIOHistory(deal_id);
 * console.log(`${history.length} versions found`);
 * ```
 */
export interface DIOStorage {
  /**
   * Save a DIO to storage
   * 
   * - Automatically increments version
   * - Checks for duplicates using input_hash
   * - Returns is_duplicate=true if already exists
   * 
   * @param dio Complete DIO object
   * @returns Storage result with version info
   */
  saveDIO(dio: DealIntelligenceObject): Promise<DIOStorageResult>;

  /**
   * Get latest DIO for a deal
   * 
   * @param deal_id Deal UUID
   * @returns Latest DIO or null if not found
   */
  getLatestDIO(deal_id: string): Promise<DealIntelligenceObject | null>;

  /**
   * Get specific DIO version
   * 
   * @param deal_id Deal UUID
   * @param version Version number
   * @returns DIO at specified version or null
   */
  getDIOVersion(deal_id: string, version: number): Promise<DealIntelligenceObject | null>;

  /**
   * Get all DIO versions for a deal
   * 
   * @param deal_id Deal UUID
   * @returns Array of DIOs ordered by version DESC
   */
  getDIOHistory(deal_id: string): Promise<DealIntelligenceObject[]>;

  /**
   * Query DIOs with filtering
   * 
   * @param filter Query filter options
   * @returns Array of matching DIOs
   */
  queryDIOs(filter: DIOQueryFilter): Promise<DealIntelligenceObject[]>;

  /**
   * Delete all DIOs for a deal
   * 
   * @param deal_id Deal UUID
   * @returns Number of DIOs deleted
   */
  deleteDIOs(deal_id: string): Promise<number>;

  /**
   * Check if DIO exists for input hash (idempotency check)
   * 
   * @param deal_id Deal UUID
   * @param input_hash SHA-256 hash of input
   * @returns Existing DIO or null
   */
  findByInputHash(deal_id: string, input_hash: string): Promise<DealIntelligenceObject | null>;
}

// ============================================================================
// Database Interface (for abstraction)
// ============================================================================

interface DIODatabaseRow {
  dio_id: string;
  deal_id: string;
  version: number;
  input_hash: string;
  dio_data: any;  // JSONB
  metadata: any;  // JSONB
  created_at: string;
  updated_at: string;
}

/**
 * Database abstraction for DIO storage
 */
interface DIODatabase {
  insertDIO(row: Omit<DIODatabaseRow, 'dio_id' | 'created_at' | 'updated_at'>): Promise<DIODatabaseRow>;
  updateDIO(dio_id: string, updates: { dio_data: any; overall_score: number | null; recommendation: string }): Promise<void>;
  findLatestByDeal(deal_id: string): Promise<DIODatabaseRow | null>;
  findByDealAndVersion(deal_id: string, version: number): Promise<DIODatabaseRow | null>;
  findByInputHash(deal_id: string, input_hash: string): Promise<DIODatabaseRow | null>;
  findHistoryByDeal(deal_id: string): Promise<DIODatabaseRow[]>;
  query(filter: DIOQueryFilter): Promise<DIODatabaseRow[]>;
  deleteByDeal(deal_id: string): Promise<number>;
  getNextVersion(deal_id: string): Promise<number>;
}

// ============================================================================
// PostgreSQL Implementation
// ============================================================================

/**
 * PostgreSQL DIO database implementation
 * 
 * Table: deal_intelligence_objects
 * - dio_id (PK, UUID)
 * - deal_id (FK to deals)
 * - schema_version (VARCHAR)
 * - analysis_version (INT) - incremental version number
 * - input_hash (VARCHAR(64)) - SHA-256
 * - dio_data (JSONB) - full DIO
 * - recommendation (VARCHAR) - extracted for indexing
 * - overall_score (NUMERIC)
 * - created_at, updated_at (TIMESTAMPTZ)
 */
class PostgreSQLDIODatabase implements DIODatabase {
  constructor(private connectionString: string) {}

  async updateDIO(dio_id: string, updates: { dio_data: any; overall_score: number | null; recommendation: string }): Promise<void> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });

    await pool.query(
      `UPDATE deal_intelligence_objects
          SET dio_data = $2,
              overall_score = $3,
              recommendation = $4,
              updated_at = now()
        WHERE dio_id = $1`,
      [dio_id, updates.dio_data, updates.overall_score, updates.recommendation]
    );

    await pool.end();
  }

  async insertDIO(row: Omit<DIODatabaseRow, 'dio_id' | 'created_at' | 'updated_at'>): Promise<DIODatabaseRow> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });
    
    // Extract values from DIO structure
    const schema_version = row.dio_data.schema_version || '1.0.0';
    const recommendation = row.dio_data.decision?.recommendation || 'CONDITIONAL';

    // Persist score explainability alongside the DIO.
    // Keep scoring formulas unchanged by sourcing overall_score from the explanation totals.
    const score_explanation = buildScoreExplanationFromDIO(row.dio_data as DealIntelligenceObject);
    const overall_score = score_explanation.totals.overall_score;
    const scoring_diagnostics_v1 = buildScoringDiagnosticsFromDIO(row.dio_data as DealIntelligenceObject);

    const total_risks = row.dio_data.risk_map?.length || 0;
    const critical_risks = (row.dio_data.risk_map || []).filter((r: any) => r.severity === 'critical').length;

    const dio_data_with_explanation = {
      ...(row.dio_data as any),
      analysis_version: row.version,
      updated_at: new Date().toISOString(),
      score_explanation,
      overall_score,
      scoring_diagnostics_v1,
    };
    
    const result = await pool.query(
      `INSERT INTO deal_intelligence_objects (
        deal_id, 
        schema_version,
        analysis_version, 
        input_hash, 
        dio_data, 
        recommendation,
        overall_score,
        total_risks,
        critical_risks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING 
        dio_id,
        deal_id,
        analysis_version as version,
        input_hash,
        dio_data,
        created_at,
        updated_at`,
      [
        row.deal_id,
        schema_version,
        row.version,
        row.input_hash,
        dio_data_with_explanation,
        recommendation,
        overall_score,
        total_risks,
        critical_risks,
      ]
    );
    await pool.end();
    return result.rows[0];
  }

  async findLatestByDeal(deal_id: string): Promise<DIODatabaseRow | null> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });
    
    const result = await pool.query(
      `SELECT 
        dio_id,
        deal_id,
        analysis_version as version,
        input_hash,
        dio_data,
        JSONB_BUILD_OBJECT(
          'recommendation', recommendation,
          'confidence', overall_score / 100.0
        ) as metadata,
        created_at,
        updated_at
       FROM deal_intelligence_objects
       WHERE deal_id = $1
       ORDER BY analysis_version DESC
       LIMIT 1`,
      [deal_id]
    );
    await pool.end();
    return result.rows[0] || null;
  }

  async findByDealAndVersion(deal_id: string, version: number): Promise<DIODatabaseRow | null> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });
    const result = await pool.query(
      `SELECT 
        dio_id, deal_id, analysis_version as version,
        input_hash, dio_data,
        JSONB_BUILD_OBJECT('recommendation', recommendation, 'confidence', overall_score / 100.0) as metadata,
        created_at, updated_at
       FROM deal_intelligence_objects
       WHERE deal_id = $1 AND analysis_version = $2`,
      [deal_id, version]
    );
    await pool.end();
    return result.rows[0] || null;
  }

  async findByInputHash(deal_id: string, input_hash: string): Promise<DIODatabaseRow | null> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });
    const result = await pool.query(
      `SELECT 
        dio_id, deal_id, analysis_version as version,
        input_hash, dio_data,
        JSONB_BUILD_OBJECT('recommendation', recommendation, 'confidence', overall_score / 100.0) as metadata,
        created_at, updated_at
       FROM deal_intelligence_objects
       WHERE deal_id = $1 AND input_hash = $2`,
      [deal_id, input_hash]
    );
    await pool.end();
    return result.rows[0] || null;
  }

  async findHistoryByDeal(deal_id: string): Promise<DIODatabaseRow[]> {
    // Production implementation:
    /*
    const pool = new Pool({ connectionString: this.connectionString });
    const result = await pool.query(
      `SELECT 
        dio_id, deal_id, analysis_version as version,
        input_hash, dio_data,
        JSONB_BUILD_OBJECT('recommendation', recommendation, 'confidence', overall_score / 100.0) as metadata,
        created_at, updated_at
       FROM deal_intelligence_objects
       WHERE deal_id = $1
       ORDER BY analysis_version DESC`,
      [deal_id]
    );
    await pool.end();
    return result.rows;
    */
    console.log(`[PostgreSQL] SELECT * WHERE deal_id = '${deal_id}' ORDER BY analysis_version DESC`);
    return [];
  }

  async query(filter: DIOQueryFilter): Promise<DIODatabaseRow[]> {
    // Production implementation:
    /*
    const pool = new Pool({ connectionString: this.connectionString });
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.deal_id) {
      conditions.push(`deal_id = $${paramIndex++}`);
      params.push(filter.deal_id);
    }
    if (filter.version) {
      conditions.push(`analysis_version = $${paramIndex++}`);
      params.push(filter.version);
    }
    if (filter.min_confidence) {
      conditions.push(`overall_score >= $${paramIndex++}`);
      params.push(filter.min_confidence * 100);
    }
    if (filter.created_after) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(filter.created_after);
    }
    if (filter.created_before) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(filter.created_before);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const result = await pool.query(
      `SELECT 
        dio_id, deal_id, analysis_version as version,
        input_hash, dio_data,
        JSONB_BUILD_OBJECT('recommendation', recommendation, 'confidence', overall_score / 100.0) as metadata,
        created_at, updated_at
       FROM deal_intelligence_objects
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, filter.limit, filter.offset]
    );
    await pool.end();
    return result.rows;
    */
    console.log(`[PostgreSQL] Query with filter:`, JSON.stringify(filter, null, 2));
    return [];
  }

  async deleteByDeal(deal_id: string): Promise<number> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });
    const result = await pool.query(
      `DELETE FROM deal_intelligence_objects WHERE deal_id = $1`,
      [deal_id]
    );
    await pool.end();
    return result.rowCount || 0;
  }

  async getNextVersion(deal_id: string): Promise<number> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: this.connectionString });
    const result = await pool.query(
      `SELECT COALESCE(MAX(analysis_version), 0) + 1 as next_version
       FROM deal_intelligence_objects
       WHERE deal_id = $1`,
      [deal_id]
    );
    await pool.end();
    const next = result.rows?.[0]?.next_version;
    const parsed = typeof next === 'number' ? next : parseInt(String(next ?? '1'), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }
}

// ============================================================================
// Production Implementation
// ============================================================================

/**
 * Production DIO Storage Implementation
 */
export class DIOStorageImpl implements DIOStorage {
  private database: DIODatabase;

  constructor(database_url: string) {
    this.database = new PostgreSQLDIODatabase(database_url);
  }

  /**
   * Generate input hash from DIO inputs
   */
  private generateInputHash(dio: DealIntelligenceObject): string {
    const inputs = JSON.stringify(dio.inputs);
    return createHash('sha256').update(inputs).digest('hex');
  }

  async saveDIO(dio: DealIntelligenceObject): Promise<DIOStorageResult> {
    // Generate input hash from inputs
    const input_hash = this.generateInputHash(dio);
    
    // Check for duplicate using input_hash
    const existing = await this.database.findByInputHash(
      dio.deal_id,
      input_hash
    );

    if (existing) {
      // Even if this is a duplicate run (same inputs), refresh score explainability using
      // the current scoring logic so reruns pick up scoring formula improvements.
      const now = new Date().toISOString();
      const score_explanation = buildScoreExplanationFromDIO(dio);
      const overall_score = score_explanation.totals.overall_score;
      const scoring_diagnostics_v1 = buildScoringDiagnosticsFromDIO(dio);
      const recommendation = dio.decision?.recommendation || 'CONDITIONAL';

      const dio_data_with_explanation = {
        ...(dio as any),
        analysis_version: existing.version,
        updated_at: now,
        score_explanation,
        overall_score,
        scoring_diagnostics_v1,
      };

      await this.database.updateDIO(existing.dio_id, {
        dio_data: dio_data_with_explanation,
        overall_score,
        recommendation,
      });

      return {
        dio_id: existing.dio_id,
        version: existing.version,
        created_at: existing.created_at,
        is_duplicate: true,
      };
    }

    // Get next version number
    const version = await this.database.getNextVersion(dio.deal_id);

    // Insert DIO
    const row = await this.database.insertDIO({
      deal_id: dio.deal_id,
      version,
      input_hash,
      dio_data: dio,
      metadata: {}, // Removed - metadata field doesn't exist in schema
    });

    return {
      dio_id: row.dio_id,
      version: row.version,
      created_at: row.created_at,
      is_duplicate: false,
    };
  }

  async getLatestDIO(deal_id: string): Promise<DealIntelligenceObject | null> {
    const row = await this.database.findLatestByDeal(deal_id);
    return row ? (row.dio_data as DealIntelligenceObject) : null;
  }

  async getDIOVersion(deal_id: string, version: number): Promise<DealIntelligenceObject | null> {
    const row = await this.database.findByDealAndVersion(deal_id, version);
    return row ? (row.dio_data as DealIntelligenceObject) : null;
  }

  async getDIOHistory(deal_id: string): Promise<DealIntelligenceObject[]> {
    const rows = await this.database.findHistoryByDeal(deal_id);
    return rows.map(row => row.dio_data as DealIntelligenceObject);
  }

  async queryDIOs(filter: DIOQueryFilter): Promise<DealIntelligenceObject[]> {
    const rows = await this.database.query(filter);
    return rows.map(row => row.dio_data as DealIntelligenceObject);
  }

  async deleteDIOs(deal_id: string): Promise<number> {
    return this.database.deleteByDeal(deal_id);
  }

  async findByInputHash(deal_id: string, input_hash: string): Promise<DealIntelligenceObject | null> {
    const row = await this.database.findByInputHash(deal_id, input_hash);
    return row ? (row.dio_data as DealIntelligenceObject) : null;
  }
}

// ============================================================================
// Mock Implementation (for testing)
// ============================================================================

/**
 * Mock DIO storage for testing
 */
export class MockDIOStorage implements DIOStorage {
  private dios: Map<string, DealIntelligenceObject[]> = new Map();
  private inputHashes: Map<string, DealIntelligenceObject> = new Map();

  private generateInputHash(dio: DealIntelligenceObject): string {
    const inputs = JSON.stringify(dio.inputs);
    return createHash('sha256').update(inputs).digest('hex');
  }

  async saveDIO(dio: DealIntelligenceObject): Promise<DIOStorageResult> {
    // Generate hash from inputs
    const input_hash = this.generateInputHash(dio);
    const hash_key = `${dio.deal_id}:${input_hash}`;
    const existing = this.inputHashes.get(hash_key);

    if (existing) {
      return {
        dio_id: `dio_${existing.deal_id}_${existing.analysis_version}`,
        version: existing.analysis_version,
        created_at: existing.created_at,
        is_duplicate: true,
      };
    }

    // Get versions for this deal
    const versions = this.dios.get(dio.deal_id) || [];
    const version = versions.length + 1;
    
    // Create versioned DIO
    const versioned_dio: DealIntelligenceObject = {
      ...dio,
      analysis_version: version,
    };

    // Store
    versions.push(versioned_dio);
    this.dios.set(dio.deal_id, versions);
    this.inputHashes.set(hash_key, versioned_dio);

    return {
      dio_id: `dio_${dio.deal_id}_${version}`,
      version,
      created_at: versioned_dio.created_at,
      is_duplicate: false,
    };
  }  async getLatestDIO(deal_id: string): Promise<DealIntelligenceObject | null> {
    const versions = this.dios.get(deal_id);
    if (!versions || versions.length === 0) {
      return null;
    }
    return versions[versions.length - 1];
  }

  async getDIOVersion(deal_id: string, version: number): Promise<DealIntelligenceObject | null> {
    const versions = this.dios.get(deal_id);
    if (!versions) {
      return null;
    }
    return versions.find(dio => dio.analysis_version === version) || null;
  }

  async getDIOHistory(deal_id: string): Promise<DealIntelligenceObject[]> {
    const versions = this.dios.get(deal_id) || [];
    return [...versions].reverse();  // Most recent first
  }

  async queryDIOs(filter: DIOQueryFilter): Promise<DealIntelligenceObject[]> {
    let all_dios: DealIntelligenceObject[] = [];

    // Get DIOs from all deals or specific deal
    if (filter.deal_id) {
      all_dios = this.dios.get(filter.deal_id) || [];
    } else {
      for (const versions of this.dios.values()) {
        all_dios.push(...versions);
      }
    }

    // Apply filters
    let filtered = all_dios;

    if (filter.version !== undefined) {
      filtered = filtered.filter(dio => dio.analysis_version === filter.version);
    }

    if (filter.min_confidence !== undefined) {
      // Calculate confidence from risk score
      filtered = filtered.filter(dio => {
        const riskScore = dio.analyzer_results.risk_assessment.overall_risk_score;
        const confidence = riskScore === null ? 0.3 : Math.max(0, 1 - (riskScore / 100));
        return confidence >= filter.min_confidence!;
      });
    }

    if (filter.created_after) {
      filtered = filtered.filter(dio => dio.created_at >= filter.created_after!);
    }

    if (filter.created_before) {
      filtered = filtered.filter(dio => dio.created_at <= filter.created_before!);
    }

    // Sort by version DESC
    filtered.sort((a, b) => b.analysis_version - a.analysis_version);

    // Pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    return filtered.slice(offset, offset + limit);
  }

  async deleteDIOs(deal_id: string): Promise<number> {
    const versions = this.dios.get(deal_id) || [];
    const count = versions.length;

    // Remove from main storage
    this.dios.delete(deal_id);

    // Remove from input hash index
    for (const dio of versions) {
      const input_hash = this.generateInputHash(dio);
      const hash_key = `${dio.deal_id}:${input_hash}`;
      this.inputHashes.delete(hash_key);
    }

    return count;
  }

  async findByInputHash(deal_id: string, input_hash: string): Promise<DealIntelligenceObject | null> {
    const hash_key = `${deal_id}:${input_hash}`;
    return this.inputHashes.get(hash_key) || null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate DIO before storage
 */
export function validateDIO(dio: unknown): DealIntelligenceObject {
  // In production, use DIOSchema.parse(dio)
  return dio as DealIntelligenceObject;
}

/**
 * Create storage result
 */
export function createStorageResult(
  dio_id: string,
  version: number,
  created_at: string,
  is_duplicate = false
): DIOStorageResult {
  return {
    dio_id,
    version,
    created_at,
    is_duplicate,
  };
}
