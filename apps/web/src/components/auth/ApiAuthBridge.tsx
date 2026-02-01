import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';

import { setAuthTokenProvider } from '../../lib/authToken';

export function ApiAuthBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) {
      setAuthTokenProvider(null);
      return;
    }

    setAuthTokenProvider(async (opts) => {
      const template = (import.meta as any)?.env?.VITE_CLERK_JWT_TEMPLATE;
      const forceRefresh = !!opts?.forceRefresh;
      const tokenOptions: any = typeof template === 'string' && template.trim().length > 0
        ? { template: template.trim() }
        : {};
      // Clerk supports bypassing cached tokens in newer versions via `skipCache`.
      // We use it when force-refreshing (e.g., SSE reconnect on 401).
      if (forceRefresh) tokenOptions.skipCache = true;

      const token = Object.keys(tokenOptions).length > 0
        ? await getToken(tokenOptions)
        : await getToken();
      return typeof token === 'string' && token.trim().length > 0 ? token : null;
    });

    return () => {
      setAuthTokenProvider(null);
    };
  }, [getToken, isSignedIn]);

  return null;
}
