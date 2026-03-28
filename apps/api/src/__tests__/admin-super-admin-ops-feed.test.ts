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

test('GET /api/v1/admin/super-admin/ops-feed rejects admin (non-super-admin)', async () => {
  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT is_admin FROM platform_access')) {
        return { rows: [{ is_admin: true }] };
      }
      if (text.includes('SELECT account_role FROM platform_access')) {
        return { rows: [{ account_role: 'admin' }] };
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
    url: '/api/v1/admin/super-admin/ops-feed',
  });

  assert.equal(res.statusCode, 403);
  const body = res.json() as any;
  assert.equal(body.code, 'SUPER_ADMIN_REQUIRED');

  await app.close();
});

test('GET /api/v1/admin/super-admin/ops-feed returns alerts and failed jobs for super_admin', async () => {
  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);

      if (text.includes('SELECT is_admin FROM platform_access')) {
        return { rows: [{ is_admin: true }] };
      }
      if (text.includes('SELECT account_role FROM platform_access')) {
        return { rows: [{ account_role: 'super_admin' }] };
      }
      if (text.includes('SELECT to_regclass($1) as oid')) {
        return { rows: [{ oid: 'exists' }] };
      }
      if (text.includes('FROM platform_audit_log')) {
        return {
          rows: [
            {
              id: 'audit-1',
              action_type: 'platform_access.revoke',
              entity_type: 'platform_access',
              entity_id: 'user-1',
              actor_user_id: 'admin-1',
              actor_role: 'super_admin',
              reason: 'security revoke',
              source: 'api',
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('FROM jobs')) {
        return {
          rows: [
            {
              job_id: 'job-1',
              type: 'analyze_deal',
              status: 'failed',
              deal_id: 'deal-1',
              document_id: null,
              message: 'analysis failed',
              error: 'timeout',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
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
    (request as any).auth = { userId: 'super-admin-user', claims: {} };
  });

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/super-admin/ops-feed?hours=24&limit=10',
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.window_hours, 24);
  assert.equal(body.system_alerts.length, 1);
  assert.equal(body.system_alerts[0].id, 'audit-1');
  assert.equal(body.error_logs.length, 1);
  assert.equal(body.error_logs[0].job_id, 'job-1');
  assert.equal(body.availability.platform_audit_log, true);
  assert.equal(body.availability.jobs, true);

  await app.close();
});
