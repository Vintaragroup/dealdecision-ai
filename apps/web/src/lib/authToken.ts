export type AuthTokenProvider = () => Promise<string | null>;

let provider: AuthTokenProvider | null = null;

export function setAuthTokenProvider(next: AuthTokenProvider | null) {
  provider = next;
}

export async function getAuthToken(): Promise<string | null> {
  if (!provider) return null;
  try {
    return await provider();
  } catch {
    return null;
  }
}
