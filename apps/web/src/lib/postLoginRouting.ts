export const ONBOARDING_STORAGE_KEY = "onboardingCompleted";

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

export type PostLoginRouteDecisionReason =
  | "already_on_onboarding"
  | "non_root_path"
  | "onboarding_incomplete"
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
    return { route: "/app/onboarding", reason: "onboarding_incomplete" };
  }

  return { route: "/app", reason: "default_dashboard" };
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
