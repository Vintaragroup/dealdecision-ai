import { describe, expect, it, vi } from 'vitest';
import { getPostLoginRoute, ONBOARDING_STORAGE_KEY } from '../postLoginRouting';

describe('getPostLoginRoute', () => {
  it('routes to onboarding when landing on /app and incomplete', () => {
    const getItem = vi.fn(() => null);
    (globalThis as any).window = {
      localStorage: { getItem },
    };

    const decision = getPostLoginRoute({ user: { publicMetadata: {} }, pathname: '/app' });
    expect(decision.route).toBe('/app/onboarding');
    expect(decision.reason).toBe('onboarding_incomplete');
    expect(getItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY);
  });

  it('routes to /app when onboarding complete via Clerk metadata', () => {
    (globalThis as any).window = {
      localStorage: { getItem: vi.fn(() => null) },
    };

    const decision = getPostLoginRoute({ user: { publicMetadata: { onboardingComplete: true } }, pathname: '/app' });
    expect(decision.route).toBe('/app');
    expect(decision.reason).toBe('default_dashboard');
  });

  it('does not redirect away from non-root /app paths', () => {
    (globalThis as any).window = {
      localStorage: { getItem: vi.fn(() => null) },
    };

    const decision = getPostLoginRoute({ user: {}, pathname: '/app/profile' });
    expect(decision.route).toBe('/app/profile');
    expect(decision.reason).toBe('non_root_path');
  });

  it('does not redirect away from onboarding route', () => {
    (globalThis as any).window = {
      localStorage: { getItem: vi.fn(() => null) },
    };

    const decision = getPostLoginRoute({ user: {}, pathname: '/app/onboarding' });
    expect(decision.route).toBe('/app/onboarding');
    expect(decision.reason).toBe('already_on_onboarding');
  });
});
