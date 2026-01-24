export const ONBOARDING_STORAGE_KEY = "onboardingCompleted";

// Only force onboarding for accounts created "just now".
// This avoids redirecting existing production users who never had the flag set.
export const DEFAULT_NEW_USER_WINDOW_MS = 15 * 60 * 1000;

function safeReadStorageFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function safeWriteStorageFlag(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore (storage may be blocked)
  }
}

function safeRemoveStorageFlag(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isOnboardingCompleteLocal(): boolean {
  return safeReadStorageFlag(ONBOARDING_STORAGE_KEY);
}

export function isOnboardingCompleteClerk(user: any): boolean {
  const publicComplete = (user?.publicMetadata as any)?.onboardingComplete;
  if (publicComplete === true) return true;

  const unsafeComplete = (user?.unsafeMetadata as any)?.onboardingComplete;
  if (unsafeComplete === true) return true;

  return false;
}

function parseUserCreatedAtMs(user: any): number | null {
  const raw = user?.createdAt;
  if (!raw) return null;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function isLikelyNewUser(user: any, nowMs: number = Date.now(), windowMs: number = DEFAULT_NEW_USER_WINDOW_MS): boolean {
  const createdAtMs = parseUserCreatedAtMs(user);
  if (createdAtMs === null) return false;
  const ageMs = nowMs - createdAtMs;
  // Future timestamps (clock skew) are treated as new.
  if (!Number.isFinite(ageMs)) return false;
  return ageMs <= windowMs;
}

export type PostLoginRouteDecisionReason =
  | "already_on_onboarding"
  | "non_root_path"
  | "onboarding_incomplete_new_user"
  | "onboarding_incomplete_existing_user"
  | "default_dashboard";

export function getPostLoginRoute(params: {
  user: any;
  pathname: string;
}): { route: string; reason: PostLoginRouteDecisionReason } {
  const { user, pathname } = params;

  if (pathname.startsWith("/app/onboarding")) {
    return { route: "/app/onboarding", reason: "already_on_onboarding" };
  }

  // Keep the change minimal/non-looping: only apply post-login routing when landing on /app.
  if (!(pathname === "/app" || pathname === "/app/")) {
    return { route: pathname, reason: "non_root_path" };
  }

  const complete = isOnboardingCompleteClerk(user) || isOnboardingCompleteLocal();
  if (!complete) {
    if (isLikelyNewUser(user)) {
      return { route: "/app/onboarding", reason: "onboarding_incomplete_new_user" };
    }
    // Default dashboard for existing users, even if their completion flag is missing.
    return { route: "/app", reason: "onboarding_incomplete_existing_user" };
  }

  return { route: "/app", reason: "default_dashboard" };
}

export async function maybeBackfillOnboardingComplete(params: {
  user: any;
  nowMs?: number;
  newUserWindowMs?: number;
}) {
  const { user, nowMs = Date.now(), newUserWindowMs = DEFAULT_NEW_USER_WINDOW_MS } = params;

  // If we already know it's complete, don't touch anything.
  if (isOnboardingCompleteClerk(user) || isOnboardingCompleteLocal()) return;

  // Never backfill for likely-new users; let them go through onboarding normally.
  if (isLikelyNewUser(user, nowMs, newUserWindowMs)) return;

  // At minimum, prevent future forced-onboarding via the local fallback.
  safeWriteStorageFlag(ONBOARDING_STORAGE_KEY, 'true');

  // Best-effort: persist on Clerk for durability across devices.
  if (user && typeof user.update === 'function') {
    const publicMetadata = (user.publicMetadata ?? {}) as Record<string, unknown>;
    const unsafeMetadata = (user.unsafeMetadata ?? {}) as Record<string, unknown>;

    try {
      await user.update({
        publicMetadata: { ...publicMetadata, onboardingComplete: true },
      } as any);
    } catch {
      try {
        await user.update({
          unsafeMetadata: { ...unsafeMetadata, onboardingComplete: true },
        } as any);
      } catch {
        // ignore
      }
    }
  }
}

export async function markOnboardingComplete(params: { user: any }) {
  const { user } = params;

  // Always set localStorage as a durable-ish fallback.
  safeWriteStorageFlag(ONBOARDING_STORAGE_KEY, "true");

  // Prefer publicMetadata if supported; fallback to unsafeMetadata.
  if (user && typeof user.update === "function") {
    const publicMetadata = (user.publicMetadata ?? {}) as Record<string, unknown>;
    const unsafeMetadata = (user.unsafeMetadata ?? {}) as Record<string, unknown>;

    try {
      await user.update({
        publicMetadata: { ...publicMetadata, onboardingComplete: true },
      } as any);
      return;
    } catch {
      await user.update({
        unsafeMetadata: { ...unsafeMetadata, onboardingComplete: true },
      } as any);
    }
  }
}

export function clearLocalOnboardingComplete() {
  safeRemoveStorageFlag(ONBOARDING_STORAGE_KEY);
}
