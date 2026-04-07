import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ScoreSourceV1 = 'legacy' | 'fundability_v1';
// TODO [CANONICAL-MIGRATION P3]: ScoreSourceV1 predates canonical_decision. The 'legacy'
// option maps to deals.score / fundability_v1.  A future 'canonical_decision' option could
// let users explicitly prefer canonical_decision.score everywhere, but requires verifying
// the canonical score is available across all consumers before surfacing this toggle.

type ScoreSourceContextValue = {
  scoreSource: ScoreSourceV1;
  setScoreSource: (next: ScoreSourceV1) => void;
};

const SCORE_SOURCE_STORAGE_KEY = 'ddai.score_source_v1';

const ScoreSourceContext = createContext<ScoreSourceContextValue | null>(null);

function readStoredScoreSource(): ScoreSourceV1 {
  try {
    const raw = localStorage.getItem(SCORE_SOURCE_STORAGE_KEY);
    if (raw === 'fundability_v1' || raw === 'legacy') return raw;
  } catch {
    // Ignore storage failures.
  }
  return 'legacy';
}

export function ScoreSourceProvider({ children }: { children: React.ReactNode }) {
  const [scoreSource, setScoreSourceState] = useState<ScoreSourceV1>(() => readStoredScoreSource());

  const setScoreSource = (next: ScoreSourceV1) => {
    setScoreSourceState(next);
    try {
      localStorage.setItem(SCORE_SOURCE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures.
    }
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SCORE_SOURCE_STORAGE_KEY) return;
      const next = readStoredScoreSource();
      setScoreSourceState(next);
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ scoreSource, setScoreSource }), [scoreSource]);

  return <ScoreSourceContext.Provider value={value}>{children}</ScoreSourceContext.Provider>;
}

export function useScoreSource(): ScoreSourceContextValue {
  const ctx = useContext(ScoreSourceContext);
  if (!ctx) {
    throw new Error('useScoreSource must be used within a ScoreSourceProvider');
  }
  return ctx;
}
