import { describe, expect, test } from '@jest/globals';
import { purgeDealCascade } from '../purge-deal-cascade';

describe('purgeDealCascade', () => {
  test('deletes ingestion_reports, deletes deal last, and returns blob summary', async () => {
    const dealId = 'deal-1';
    const calls: Array<{ sql: string; params?: unknown[] }> = [];

    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql: String(sql), params });
        const q = String(sql);

        if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };

        if (q.includes('SELECT id FROM deals WHERE id = $1')) {
          return { rows: [{ id: dealId }] };
        }

        if (q.includes('SELECT COUNT(*)::text as count FROM documents')) {
          return { rows: [{ count: '1' }] };
        }
        if (q.includes('SELECT COUNT(*)::text as count FROM evidence')) {
          return { rows: [{ count: '2' }] };
        }
        if (q.includes('SELECT COUNT(*)::text as count FROM jobs')) {
          return { rows: [{ count: '0' }] };
        }
        if (q.includes('SELECT COUNT(*)::text as count FROM deal_intelligence_objects')) {
          return { rows: [{ count: '3' }] };
        }

        if (q.includes('SELECT DISTINCT df.sha256')) {
          return { rows: [{ sha256: 'sha-1' }] };
        }

        if (q.includes('DELETE FROM ingestion_reports')) {
          return { rows: [], rowCount: 4 };
        }

        if (q.includes('DELETE FROM deal_evidence')) {
          // Simulate missing table (relation does not exist)
          const err: any = new Error('relation does not exist');
          err.code = '42P01';
          throw err;
        }

        if (q.includes('DELETE FROM deal_intelligence_objects')) {
          return { rows: [], rowCount: 3 };
        }

        if (q.includes('DELETE FROM deals WHERE id = $1')) {
          return { rows: [], rowCount: 1 };
        }

        if (q.includes('DELETE FROM document_file_blobs')) {
          return { rows: [{ sha256: 'sha-1' }], rowCount: 1 };
        }

        throw new Error(`Unexpected SQL in test: ${q}`);
      },
      release: () => {},
    };

    const db = {
      connect: async () => client,
    } as any;

    const result = await purgeDealCascade({ deal_id: dealId, actor_user_id: 'tester', db });

    expect(result.ok).toBe(true);
    expect(result.deal_id).toBe(dealId);
    expect(result.expected_deleted).toEqual({
      documents: 1,
      evidence: 2,
      jobs: 0,
      deal_intelligence_objects: 3,
    });
    expect(result.deleted.ingestion_reports).toBe(4);
    expect(result.deleted.deal_row).toBe(1);
    expect(result.blobs.attempted_sha256).toEqual(['sha-1']);
    expect(result.blobs.deleted_unreferenced_blobs).toBe(1);

    const deleteDealIndex = calls.findIndex((c) => c.sql.includes('DELETE FROM deals WHERE id = $1'));
    const deleteIngestionIndex = calls.findIndex((c) => c.sql.includes('DELETE FROM ingestion_reports'));
    const deleteDioIndex = calls.findIndex((c) => c.sql.includes('DELETE FROM deal_intelligence_objects'));
    expect(deleteIngestionIndex).toBeGreaterThanOrEqual(0);
    expect(deleteDioIndex).toBeGreaterThanOrEqual(0);
    expect(deleteDealIndex).toBeGreaterThan(deleteIngestionIndex);
    expect(deleteDealIndex).toBeGreaterThan(deleteDioIndex);
  });
});
