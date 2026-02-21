import { useCallback, useEffect, useRef } from 'react';

export function useAsyncStaleGuard<T>(initialKey: T) {
  const mountedRef = useRef(true);
  const currentKeyRef = useRef<T>(initialKey);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markKey = useCallback((newKey: T) => {
    currentKeyRef.current = newKey;
  }, []);

  const isStale = useCallback(
    (keyAtStart: T) => {
      return !mountedRef.current || keyAtStart !== currentKeyRef.current;
    },
    [],
  );

  return { isStale, markKey };
}
