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
      const token = await getToken();
      return typeof token === 'string' && token.trim().length > 0 ? token : null;
    });

    return () => {
      setAuthTokenProvider(null);
    };
  }, [getToken, isSignedIn]);

  return null;
}
