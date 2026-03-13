/**
 * insightsStore.ts — Lightweight UI-only store for Investor Insights preferences.
 *
 * Stores NO server data. Only manages UI preferences (viewMode).
 * Implemented as a module-level singleton with React subscriptions (no Zustand dependency).
 */

import { useState, useEffect } from 'react';
import type { ViewMode } from '../types/investor-insights';

// ─── Store shape ──────────────────────────────────────────────────────────────

type InsightsStoreState = {
  viewMode: ViewMode;
};

type Listener = (state: InsightsStoreState) => void;

// ─── Singleton module-level state ─────────────────────────────────────────────

let _state: InsightsStoreState = { viewMode: 'quick' };
const _listeners = new Set<Listener>();

function _setState(partial: Partial<InsightsStoreState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((l) => l(_state));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInsightsStore() {
  const [localState, setLocalState] = useState<InsightsStoreState>(_state);

  useEffect(() => {
    // Sync with any state change that occurred before mount
    setLocalState(_state);

    const listener: Listener = (s) => setLocalState(s);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  return {
    viewMode: localState.viewMode,
    setViewMode: (mode: ViewMode) => _setState({ viewMode: mode }),
  };
}
