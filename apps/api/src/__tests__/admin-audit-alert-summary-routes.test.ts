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

test('GET /api/v1/admin/audit-alerts/summary returns alert totals and recent events', async () => {
  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);

      if (text.includes('SELECT to_regclass($1) as oid')) {
        return { rows: [{ oid: 'platform_audit_log' }] };
      }

      if (text.includes('SELECT action_type, COUNT(*)::text AS count')) {
        return {
          rows: [
            { action_type: 'platform_access.revoke', count: '2' },
            { action_type: 'invite.redeem', count: '1' },
          ],
        };
      }

      if (text.includes('SELECT COUNT(*)::text AS total')) {
        return { rows: [{ total: '3' }] };
      }

      if (text.includes('SELECT id, action_type, entity_type, entity_id')) {
        return {
          rows: [
            {
              id: 'audit-1',
              action_type: 'platform_access.revoke',
              entity_type: 'platform_access',
              entity_id: 'user-2',
              actor_user_id: 'admin-1',
              actor_role: 'admin',
              reason: 'security revoke',
              source: 'api',
              created_at: new Date().toISOString(),
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
    (request as any).auth = {
      userId: 'dev-user',
      claims: { bypass_auth: true },
    };
  });

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/audit-alerts/summary?hours=24&limit=10',
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.window_hours, 24);
  assert.equal(body.total_alerts, 3);
  assert.equal(body.by_action.length, 2);
  assert.equal(body.by_action[0].action_type, 'platform_access.revoke');
  assert.equal(body.by_action[0].count, 2);
  assert.equal(body.recent_events.length, 1);
  assert.equal(body.recent_events[0].id, 'audit-1');

  await app.close();
});
