import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';

type DealsListDebugSnapshot = {
  ts: number;
  orgId?: string | null;
  liveDeals: number;
  deals: number;
  filteredDeals: number;
  searchQuery: string;
  stageFilter: string;
  priorityFilter: string;
};

function getLocalStorageValue(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;

    const params = new URLSearchParams(window.location.search);
    const forcedByQuery = params.get('debugDealsList') === '1';
    if (forcedByQuery) return true;

    const showOverride = getLocalStorageValue('ddai:showDealsListDebugBadge');
    if (showOverride) {
      const v = showOverride.trim().toLowerCase();
      if (v === '0' || v === 'false' || v === 'off') return false;
      if (v === '1' || v === 'true' || v === 'on') return true;
    }

    const debugDeals = getLocalStorageValue('ddai:debugDealsList');
    if (!debugDeals) return false;
    const v = debugDeals.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  } catch {
    return false;
  }
}

function readSnapshot(): DealsListDebugSnapshot | null {
  try {
    if (typeof window === 'undefined') return null;
    const w = window as any;
    const snap = w.__ddaiDealsListDebug;
    if (!snap || typeof snap !== 'object') return null;
    if (typeof snap.ts !== 'number') return null;
    return snap as DealsListDebugSnapshot;
  } catch {
    return null;
  }
}

export function DealsListDebugBadge() {
  const [enabled, setEnabled] = useState<boolean>(() => isEnabled());
  const [snapshot, setSnapshot] = useState<DealsListDebugSnapshot | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setEnabled(isEnabled());
      setSnapshot(readSnapshot());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const lastUpdatedLabel = useMemo(() => {
    if (!snapshot?.ts) return '—';
    const d = new Date(snapshot.ts);
    return Number.isFinite(d.getTime()) ? d.toLocaleTimeString() : '—';
  }, [snapshot?.ts]);

  if (!enabled) return null;

  const copyToClipboard = async () => {
    try {
      const text = JSON.stringify(
        {
          enabled,
          snapshot,
        },
        null,
        2
      );
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const hide = () => {
    try {
      window.localStorage.setItem('ddai:showDealsListDebugBadge', '0');
      setEnabled(isEnabled());
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[60]">
      <div className="rounded-lg border border-white/10 bg-black/80 text-white shadow-xl backdrop-blur px-3 py-2 w-[320px]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium">Deals debug</div>
          <div className="text-[10px] text-white/60">{lastUpdatedLabel}</div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded bg-white/5 px-2 py-1">
            <div className="text-[10px] text-white/60">liveDeals</div>
            <div className="text-sm">{snapshot?.liveDeals ?? '—'}</div>
          </div>
          <div className="rounded bg-white/5 px-2 py-1">
            <div className="text-[10px] text-white/60">deals</div>
            <div className="text-sm">{snapshot?.deals ?? '—'}</div>
          </div>
          <div className="rounded bg-white/5 px-2 py-1">
            <div className="text-[10px] text-white/60">filtered</div>
            <div className="text-sm">{snapshot?.filteredDeals ?? '—'}</div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-white/80">
          <div>stage: <span className="text-white/90">{snapshot?.stageFilter ?? '—'}</span></div>
          <div>priority: <span className="text-white/90">{snapshot?.priorityFilter ?? '—'}</span></div>
          <div>search: <span className="text-white/90">{snapshot?.searchQuery ?? '—'}</span></div>
          <div>org: <span className="text-white/90">{snapshot?.orgId ?? '—'}</span></div>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={copyToClipboard}>Copy</Button>
          <Button variant="outline" size="sm" onClick={hide}>Hide</Button>
        </div>

        <div className="mt-1 text-[10px] text-white/50">
          window.__ddaiDealsListDebug
        </div>
      </div>
    </div>
  );
}
