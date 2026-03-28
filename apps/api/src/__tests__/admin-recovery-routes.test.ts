process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/// <reference path="../types/auth.d.ts" />

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAdminRoutes } from '../routes/admin';
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

test('POST /api/v1/admin/recovery/deals/:dealId/purge requires reason', async () => {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'dev-user',
      claims: { bypass_auth: true },
    };
  });

  const mockPool = {
    query: async () => ({ rows: [] }),
  } as any;
  setMockPool(mockPool);

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/deals/deal-1/purge',
    payload: { confirm_text: 'PURGE DEAL deal-1' },
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.code, 'MISSING_AUDIT_REASON');

  await app.close();
});

test('POST /api/v1/admin/recovery/deals/:dealId/purge rejects confirmation mismatch', async () => {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'dev-user',
      claims: { bypass_auth: true },
    };
  });

  const mockPool = {
    query: async () => ({ rows: [] }),
  } as any;
  setMockPool(mockPool);

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/deals/deal-1/purge',
    payload: {
      reason: 'cleanup',
      confirm_text: 'PURGE DEAL wrong-id',
    },
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.code, 'PURGE_CONFIRMATION_MISMATCH');
  assert.match(String(body.error ?? ''), /PURGE DEAL deal-1/);

  await app.close();
});

test('POST /api/v1/admin/recovery/deals/:dealId/purge requires super_admin role in db-backed auth path', async () => {
  const observedQueries: string[] = [];

  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);
      observedQueries.push(text);

      if (text.includes('SELECT is_admin FROM platform_access')) {
        return { rows: [{ is_admin: true }] };
      }

      if (text.includes('SELECT account_role FROM platform_access')) {
        return { rows: [{ account_role: 'admin' }] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'admin-user',
      claims: {},
    };
  });

  setMockPool(mockPool);
  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/deals/deal-1/purge',
    payload: {
      reason: 'cleanup',
      confirm_text: 'PURGE DEAL deal-1',
    },
  });

  assert.equal(res.statusCode, 403);
  const body = res.json() as any;
  assert.equal(body.code, 'SUPER_ADMIN_REQUIRED');

  assert.ok(
    observedQueries.some((q) => q.includes('SELECT is_admin FROM platform_access')),
    'expected admin preHandler db check'
  );
  assert.ok(
    observedQueries.some((q) => q.includes('SELECT account_role FROM platform_access')),
    'expected super_admin db check'
  );

  await app.close();
});

test('POST /api/v1/admin/recovery/deals/:dealId/restore requires reason', async () => {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'dev-user',
      claims: { bypass_auth: true },
    };
  });

  const mockPool = {
    query: async () => ({ rows: [] }),
  } as any;
  setMockPool(mockPool);

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/deals/deal-1/restore',
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  const body = res.json() as any;
  assert.equal(body.code, 'MISSING_AUDIT_REASON');

  await app.close();
});

test('POST /api/v1/admin/recovery/deals/:dealId/restore writes canonical audit row on success', async () => {
  const auditCalls: any[] = [];
  setAuditWriteMock(async (input: any) => {
    auditCalls.push(input);
    return { id: 'audit-1', ...input };
  });

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'dev-user',
      orgRole: 'org:admin',
      claims: { bypass_auth: true },
    };
  });

  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM deals WHERE id = $1 LIMIT 1')) {
        return { rows: [{ id: 'deal-restore-1', deleted_at: '2026-03-27T00:00:00.000Z' }] };
      }
      if (text.includes('UPDATE deals') && text.includes('SET deleted_at = NULL')) {
        return { rows: [{ id: 'deal-restore-1', deleted_at: null, lifecycle_status: 'active' }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;
  setMockPool(mockPool);

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/deals/deal-restore-1/restore',
    payload: { reason: 'restore for validation' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action_type, 'deal.restore');
  assert.equal(auditCalls[0].entity_type, 'deal');
  assert.equal(auditCalls[0].entity_id, 'deal-restore-1');
  assert.equal(auditCalls[0].reason, 'restore for validation');

  await app.close();
});

test('POST /api/v1/admin/recovery/documents/:documentId/purge writes canonical audit row on success', async () => {
  const auditCalls: any[] = [];
  setAuditWriteMock(async (input: any) => {
    auditCalls.push(input);
    return { id: 'audit-2', ...input };
  });

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'dev-user',
      orgRole: 'org:admin',
      claims: { bypass_auth: true },
    };
  });

  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT id, deal_id, title, status, deleted_at') && text.includes('FROM documents')) {
        return { rows: [{ id: 'doc-purge-1', deal_id: 'deal-1', title: 'Deck', deleted_at: '2026-03-27T00:00:00.000Z' }] };
      }
      if (text.includes('DELETE FROM documents') && text.includes('RETURNING id, deal_id')) {
        return { rows: [{ id: 'doc-purge-1', deal_id: 'deal-1' }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as any;
  setMockPool(mockPool);

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/documents/doc-purge-1/purge',
    payload: {
      reason: 'document purge for validation',
      confirm_text: 'PURGE DOCUMENT doc-purge-1',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action_type, 'document.hard_delete');
  assert.equal(auditCalls[0].entity_type, 'document');
  assert.equal(auditCalls[0].entity_id, 'doc-purge-1');
  assert.equal(auditCalls[0].reason, 'document purge for validation');

  await app.close();
});

test('POST /api/v1/admin/recovery/deals/:dealId/purge writes canonical audit row on success', async () => {
  const auditCalls: any[] = [];
  setAuditWriteMock(async (input: any) => {
    auditCalls.push(input);
    return { id: 'audit-3', ...input };
  });

  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as any).auth = {
      userId: 'dev-user',
      orgRole: 'org:admin',
      claims: { bypass_auth: true },
    };
  });

  const txQuery = async (sql: string) => {
    const text = String(sql);

    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes('SELECT id FROM deals WHERE id = $1')) {
      return { rows: [{ id: 'deal-purge-1' }], rowCount: 1 };
    }

    if (text.includes('SELECT COUNT(*)::text as count FROM documents WHERE deal_id = $1')) {
      return { rows: [{ count: '1' }], rowCount: 1 };
    }
    if (text.includes('SELECT COUNT(*)::text as count FROM evidence WHERE deal_id = $1')) {
      return { rows: [{ count: '0' }], rowCount: 1 };
    }
    if (text.includes('SELECT COUNT(*)::text as count FROM jobs WHERE deal_id = $1')) {
      return { rows: [{ count: '0' }], rowCount: 1 };
    }
    if (text.includes('SELECT COUNT(*)::text as count FROM deal_intelligence_objects WHERE deal_id = $1')) {
      return { rows: [{ count: '0' }], rowCount: 1 };
    }

    if (text.includes('SELECT DISTINCT df.sha256')) {
      return { rows: [], rowCount: 0 };
    }

    if (text.includes('DELETE FROM ingestion_reports WHERE deal_id = $1')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('DELETE FROM deal_evidence WHERE deal_id = $1')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('DELETE FROM deal_intelligence_objects WHERE deal_id = $1')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('DELETE FROM deals WHERE id = $1')) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('DELETE FROM document_file_blobs b')) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected tx query: ${text}`);
  };

  const mockPool = {
    query: async (sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT * FROM deals WHERE id = $1 LIMIT 1')) {
        return { rows: [{ id: 'deal-purge-1', deleted_at: '2026-03-27T00:00:00.000Z' }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    connect: async () => ({
      query: txQuery,
      release: () => {},
    }),
  } as any;
  setMockPool(mockPool);

  await registerAdminRoutes(app);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/recovery/deals/deal-purge-1/purge',
    payload: {
      reason: 'deal purge for validation',
      confirm_text: 'PURGE DEAL deal-purge-1',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action_type, 'deal.purge');
  assert.equal(auditCalls[0].entity_type, 'deal');
  assert.equal(auditCalls[0].entity_id, 'deal-purge-1');
  assert.equal(auditCalls[0].reason, 'deal purge for validation');

  await app.close();
});
