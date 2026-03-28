process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/// <reference path="../types/auth.d.ts" />

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { registerAdminRoutes } from '../routes/admin';
import * as dbLib from '../lib/db';

function setMockPool(mockPool: any) {
  Object.defineProperty(dbLib, 'getPool', {
    value: () => mockPool,
    configurable: true,
  });
}

test('GET /api/v1/admin/users/:id/analytics returns aggregated metrics with explicit unsupported metric flags', async () => {
  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);

      if (text.includes('SELECT is_admin FROM platform_access')) {
        return { rows: [{ is_admin: true }] };
      }
      if (text.includes('SELECT to_regclass($1) as oid')) {
        return { rows: [{ oid: 'exists' }] };
      }
      if (text.includes('FROM platform_access') && text.includes('WHERE clerk_user_id = $1') && text.includes('access_status')) {
        return {
          rows: [
            {
              clerk_user_id: 'user-123',
              org_id: 'org-1',
              access_status: 'active',
              access_expires_at: null,
              is_admin: false,
              account_role: 'analyst',
              grant_source: 'invite',
              notes: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('FROM organization_memberships')) {
        return {
          rows: [
            {
              clerk_org_id: 'org-1',
              org_role: 'org_member',
              membership_status: 'active',
              seat_consuming: true,
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('COUNT(*)::text AS total_deals')) {
        return {
          rows: [
            {
              total_deals: '2',
              active_deals: '1',
              archived_deals: '1',
              last_deal_activity_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('SELECT') && text.includes('d.id AS deal_id') && text.includes('FROM deals d')) {
        return {
          rows: [
            {
              deal_id: 'deal-1',
              name: 'Deal One',
              stage: 'analysis',
              lifecycle_status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              document_count: '3',
              total_jobs: '2',
              failed_jobs: '1',
              last_job_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('COUNT(*)::text AS total_documents')) {
        return {
          rows: [{ total_documents: '3', last_document_activity_at: new Date().toISOString() }],
        };
      }
      if (text.includes('COUNT(*)::text AS total_jobs') && text.includes('FROM jobs j')) {
        return {
          rows: [{ total_jobs: '2', failed_jobs: '1', last_job_activity_at: new Date().toISOString() }],
        };
      }
      if (text.includes('FROM node_ai_analyses')) {
        return {
          rows: [{ analyses_total: '4', llm_called_total: '3', last_ai_activity_at: new Date().toISOString() }],
        };
      }
      if (text.includes('FROM platform_audit_log')) {
        return {
          rows: [
            {
              id: 'audit-1',
              action_type: 'platform_access.extend',
              entity_type: 'platform_access',
              entity_id: 'user-123',
              reason: 'manual extension',
              source: 'ui',
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('j.job_id') && text.includes('FROM jobs j')) {
        return {
          rows: [
            {
              job_id: 'job-1',
              type: 'analyze_deal',
              status: 'failed',
              deal_id: 'deal-1',
              message: 'failed run',
              error: 'timeout',
              at: new Date().toISOString(),
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;

  setMockPool(mockPool);

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = { userId: 'admin-user', claims: {} };
  });

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/users/user-123/analytics?days=30',
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.user.clerk_user_id, 'user-123');
  assert.equal(body.kpis.total_deals, 2);
  assert.equal(body.kpis.total_documents, 3);
  assert.equal(body.kpis.total_jobs, 2);
  assert.equal(body.kpis.failed_jobs, 1);
  assert.equal(body.kpis.ai_analyses_total, 4);
  assert.equal(body.deals.length, 1);
  assert.equal(body.activity.length, 2);
  assert.equal(body.data_quality.unsupported_metrics.chat_sessions.status, 'unavailable');
  assert.equal(body.data_quality.unsupported_metrics.token_usage.status, 'unavailable');

  await app.close();
});
