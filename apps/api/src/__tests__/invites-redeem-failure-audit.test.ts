process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/// <reference path="../types/auth.d.ts" />

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { registerInviteRoutes } from '../routes/invites';
import * as dbLib from '../lib/db';
import * as auditLib from '../lib/platform-audit-log';

function setMockPool(mockPool: any) {
  Object.defineProperty(dbLib, 'getPool', {
    value: () => mockPool,
    configurable: true,
  });
}

function setAuditWriteMock(fn: (input: any) => Promise<any>) {
  Object.defineProperty(auditLib, 'writePlatformAuditLog', {
    value: fn,
    configurable: true,
  });
}

test('POST /api/v1/invites/redeem writes invite.expired audit event when invite is expired', async () => {
  const auditCalls: any[] = [];
  setAuditWriteMock(async (input: any) => {
    auditCalls.push(input);
    return { id: 'audit-1', ...input };
  });

  const expiredTs = new Date(Date.now() - 60_000).toISOString();

  const client = {
    query: async (sql: string) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'ROLLBACK') {
        return { rows: [] };
      }
      if (text.includes('SELECT * FROM invite_codes WHERE code = $1 LIMIT 1 FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'inv-1',
              code: 'exp-123',
              email: null,
              org_id: null,
              status: 'active',
              access_duration_days: 7,
              expires_at: expiredTs,
              redeemed_at: null,
              redeemed_by_clerk_user_id: null,
              redeemed_email: null,
              grant_source: 'invite',
              notes: null,
              created_by_user_id: 'admin-user',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    release: () => undefined,
  };

  const mockPool = {
    connect: async () => client,
  } as any;
  setMockPool(mockPool);

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'redeemer-1',
      claims: { email: 'user@example.com', bypass_auth: true },
    };
  });

  await registerInviteRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/invites/redeem',
    payload: { code: 'exp-123' },
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.code, 'INVITE_EXPIRED');

  const expiredAudit = auditCalls.find((c) => c.action_type === 'invite.expired');
  assert.ok(expiredAudit, 'expected invite.expired audit event');
  assert.equal(expiredAudit.entity_id, 'exp-123');

  await app.close();
});

test('POST /api/v1/invites/redeem writes invite.redeem_failed audit event on email mismatch', async () => {
  const auditCalls: any[] = [];
  setAuditWriteMock(async (input: any) => {
    auditCalls.push(input);
    return { id: 'audit-2', ...input };
  });

  const client = {
    query: async (sql: string) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'ROLLBACK') {
        return { rows: [] };
      }
      if (text.includes('SELECT * FROM invite_codes WHERE code = $1 LIMIT 1 FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'inv-2',
              code: 'mail-123',
              email: 'different@example.com',
              org_id: null,
              status: 'active',
              access_duration_days: 7,
              expires_at: null,
              redeemed_at: null,
              redeemed_by_clerk_user_id: null,
              redeemed_email: null,
              grant_source: 'invite',
              notes: null,
              created_by_user_id: 'admin-user',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    release: () => undefined,
  };

  const mockPool = {
    connect: async () => client,
  } as any;
  setMockPool(mockPool);

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'redeemer-2',
      claims: { email: 'user@example.com', bypass_auth: true },
    };
  });

  await registerInviteRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/invites/redeem',
    payload: { code: 'mail-123' },
  });

  assert.equal(res.statusCode, 403);
  const body = res.json() as any;
  assert.equal(body.code, 'INVITE_EMAIL_MISMATCH');

  const failedAudit = auditCalls.find((c) => c.action_type === 'invite.redeem_failed');
  assert.ok(failedAudit, 'expected invite.redeem_failed audit event');
  assert.equal(failedAudit.entity_id, 'mail-123');

  await app.close();
});
