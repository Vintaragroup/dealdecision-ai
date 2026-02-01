import { describe, it, expect } from 'vitest';
import { shouldRefreshToken } from './authToken';

describe('authToken refresh logic', () => {
  it('refreshes when exp is within 30s', () => {
    const now = 1000;
    expect(shouldRefreshToken(1029, now, 30)).toBe(true);
    expect(shouldRefreshToken(1030, now, 30)).toBe(false);
  });

  it('refreshes when exp missing', () => {
    const now = 1000;
    expect(shouldRefreshToken(null, now, 30)).toBe(true);
  });
});
