import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __resetAuthCachesForTest, verifyClerkJwtForTest } from '../src/plugins/clerk-auth';

test('AUTH_CLOCK_TOLERANCE_SECONDS=60 allows exp=now-30 but rejects exp=now-120', async () => {
  __resetAuthCachesForTest();

  process.env.AUTH_CLOCK_TOLERANCE_SECONDS = '60';

  const jose: any = await import('jose');

  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');

  const now = new Date('2026-01-25T12:00:00.000Z');
  const nowEpoch = Math.floor(now.getTime() / 1000);

  const sign = async (expEpoch: number) => {
    return await new jose.SignJWT({ foo: 'bar' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('user_123')
      .setIssuedAt(nowEpoch - 10)
      .setExpirationTime(expEpoch)
      .sign(privateKey);
  };

  const tokenNearExpired = await sign(nowEpoch - 30);
  const tokenTooOld = await sign(nowEpoch - 120);

  // Should pass due to 60s leeway.
  const payload1 = await verifyClerkJwtForTest({ token: tokenNearExpired, key: publicKey, currentDate: now });
  assert.equal(payload1.sub, 'user_123');

  // Should fail even with leeway.
  let failed = false;
  try {
    await verifyClerkJwtForTest({ token: tokenTooOld, key: publicKey, currentDate: now });
  } catch (err: any) {
    failed = true;
    assert.match(String(err?.message ?? err), /exp|expired|timestamp/i);
  }
  assert.equal(failed, true);
});
