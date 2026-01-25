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

    setAuthTokenProvider(async () => {
      const template = (import.meta as any)?.env?.VITE_CLERK_JWT_TEMPLATE;
      const token = typeof template === 'string' && template.trim().length > 0
        ? await getToken({ template: template.trim() } as any)
        : await getToken();
      return typeof token === 'string' && token.trim().length > 0 ? token : null;
    });

    return () => {
      setAuthTokenProvider(null);
    };
  }, [getToken, isSignedIn]);

  return null;
}
