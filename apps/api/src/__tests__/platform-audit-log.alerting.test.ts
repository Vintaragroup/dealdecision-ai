import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writePlatformAuditLog } from '../lib/platform-audit-log';

test('writePlatformAuditLog dispatches governance alerts for high-signal actions', async () => {
  const mockDb = {
    query: async () => ({
      rows: [
        {
          id: 'audit-1',
          actor_user_id: 'user-1',
          actor_role: 'admin',
          action_type: 'platform_access.revoke',
          entity_type: 'platform_access',
          entity_id: 'user-2',
          before_state: {},
          after_state: {},
          reason: 'security revoke',
          source: 'api',
          created_at: new Date().toISOString(),
        },
      ],
    }),
  } as any;

  const dispatched: any[] = [];

  await writePlatformAuditLog(
    {
      actor_user_id: 'user-1',
      actor_role: 'admin',
      action_type: 'platform_access.revoke',
      entity_type: 'platform_access',
      entity_id: 'user-2',
      reason: 'security revoke',
      source: 'api',
    },
    {
      db: mockDb,
      alertDispatcher: async (row) => {
        dispatched.push(row);
      },
    }
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].action_type, 'platform_access.revoke');
});

test('writePlatformAuditLog does not dispatch governance alerts for non-alert actions', async () => {
  const mockDb = {
    query: async () => ({
      rows: [
        {
          id: 'audit-2',
          actor_user_id: 'user-1',
          actor_role: 'admin',
          action_type: 'deal.archive',
          entity_type: 'deal',
          entity_id: 'deal-1',
          before_state: {},
          after_state: {},
          reason: 'archive',
          source: 'api',
          created_at: new Date().toISOString(),
        },
      ],
    }),
  } as any;

  const dispatched: any[] = [];

  await writePlatformAuditLog(
    {
      actor_user_id: 'user-1',
      actor_role: 'admin',
      action_type: 'deal.archive',
      entity_type: 'deal',
      entity_id: 'deal-1',
      reason: 'archive',
      source: 'api',
    },
    {
      db: mockDb,
      alertDispatcher: async (row) => {
        dispatched.push(row);
      },
    }
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dispatched.length, 0);
});
