/**
 * Factory for creating fully initialized analysis pipeline
 */

import { DealOrchestrator } from './orchestrator.js';
import { createAnalyzerRegistry } from '../analyzers/registry.js';
import { DIOStorageImpl } from '../services/dio-storage.js';

/**
 * Create a fully initialized orchestrator with all dependencies
 */
export async function createDealOrchestrator(): Promise<DealOrchestrator> {
  // Get database URL from environment
  const database_url = process.env.DATABASE_URL;
  if (!database_url) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Initialize services  
  const storage = new DIOStorageImpl(database_url);
  
  // Initialize analyzer registry with all analyzers
  // Note: Analyzers will create their own LLM service instances
  const analyzers = createAnalyzerRegistry();
  
  // Create and return orchestrator with debug enabled
  return new DealOrchestrator(analyzers, storage, { debug: true });
}

/**
 * Run full analysis for a deal
 * This is a simplified version that runs one cycle of analysis
 */
export async function runDealAnalysis(dealId: string): Promise<{
  success: boolean;
  dio?: any;
  storage_result?: any;
  execution?: any;
  failures?: any;
  error?: string;
}> {
  try {
    console.log(`[runDealAnalysis] Starting for deal: ${dealId}`);
    
    // Get database URL for document fetching
    const database_url = process.env.DATABASE_URL;
    if (!database_url) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    console.log('[runDealAnalysis] Fetching documents...');
    // Fetch documents for the deal
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: database_url });
    const { rows: documents } = await pool.query(
      `SELECT id, title, structured_data, extraction_metadata FROM documents WHERE deal_id = $1 AND status = 'completed'`,
      [dealId]
    );
    await pool.end();

    console.log(`[runDealAnalysis] Found ${documents.length} documents`);

    if (documents.length === 0) {
      return {
        success: false,
        error: `No completed documents found for deal ${dealId}`,
      };
    }

    // Prepare input data from documents
    const input_data: Record<string, any> = {};
    
    // For each analyzer, prepare relevant data from documents
    for (const doc of documents) {
      const structured = doc.structured_data || {};
      const metadata = doc.extraction_metadata || {};
      
      // Combine all document data - analyzers will filter what they need
      if (!input_data.documents) {
        input_data.documents = [];
      }
      input_data.documents.push({
        document_id: doc.id,  // Use 'id' column from database, map to 'document_id' in DIO
        title: doc.title,
        ...structured,
        ...metadata,
      });
    }

    console.log(`[runDealAnalysis] Prepared input_data with ${input_data.documents?.length} documents`);
    console.log('[runDealAnalysis] Creating orchestrator...');

    const orchestrator = await createDealOrchestrator();
    
    console.log('[runDealAnalysis] Running analysis...');
    // Run analysis with deal_id and prepared input data
    const result = await orchestrator.analyze({
      deal_id: dealId,
      analysis_cycle: 1,
      input_data,
    });
    
    console.log(`[runDealAnalysis] Analysis complete. Success: ${result.success}, DIO ID: ${result.dio?.dio_id}`);
    
    return {
      success: result.success,
      dio: result.dio,
      storage_result: result.storage_result,
      execution: result.execution,
      failures: result.failures,
      error: result.success ? undefined : (result.error ?? 'Unknown error'),
    };
  } catch (error) {
    console.error('[runDealAnalysis] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
