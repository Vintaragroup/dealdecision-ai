import { useEffect, useMemo, useState } from 'react';

type ApiMutationLogEntry = {
  ts: number;
  method: string;
  url: string;
  path: string;
  status: number;
  duration_ms: number;
  ok: boolean;
  error?: string;
};

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function isPanelEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const raw = readLocalStorage('ddai:showApiMutationsPanel');
  if (raw) {
    const v = raw.trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'off') return false;
  }

  try {
    const url = new URL(window.location.href);
    const qp = url.searchParams.get('debugApiMutations');
    if (qp && ['1', 'true', 'on', 'yes'].includes(qp.trim().toLowerCase())) return true;
  } catch {
    // ignore
  }

  return false;
}

function getEntries(): ApiMutationLogEntry[] {
  try {
    const w = window as any;
    const entries = w.__ddaiApiMutations;
    return Array.isArray(entries) ? (entries as ApiMutationLogEntry[]) : [];
  } catch {
    return [];
  }
}

function setEntries(next: ApiMutationLogEntry[]) {
  try {
    const w = window as any;
    w.__ddaiApiMutations = next;
  } catch {
    // ignore
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

export function ApiMutationsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntriesState] = useState<ApiMutationLogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setEnabled(isPanelEnabled());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      setEntriesState(getEntries());
    };

    refresh();
    const id = window.setInterval(refresh, 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  const visibleEntries = useMemo(() => {
    const max = expanded ? 50 : 8;
    return entries.slice(0, max);
  }, [entries, expanded]);

  if (!enabled) return null;

  const clear = () => {
    setEntries([]);
    setEntriesState([]);
  };

  const copy = async () => {
    try {
      const payload = JSON.stringify(entries, null, 2);
      await navigator.clipboard.writeText(payload);
    } catch {
      // ignore
    }
  };

  const disable = () => {
    writeLocalStorage('ddai:showApiMutationsPanel', '0');
    setEnabled(false);
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[2000] w-[520px] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-black/80 backdrop-blur text-white shadow-2xl"
      role="region"
      aria-label="API mutation log"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <div className="min-w-0">
          <div className="text-sm font-medium">API Mutations</div>
          <div className="text-[11px] text-white/60 truncate">
            {entries.length} event(s) · newest first · window.__ddaiApiMutations
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/15"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Less' : 'More'}
          </button>
          <button
            className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/15"
            onClick={copy}
          >
            Copy
          </button>
          <button
            className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/15"
            onClick={clear}
          >
            Clear
          </button>
          <button
            className="text-[11px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30"
            onClick={disable}
          >
            Hide
          </button>
        </div>
      </div>

      <div className="max-h-[45vh] overflow-auto">
        {visibleEntries.length === 0 ? (
          <div className="px-4 py-3 text-sm text-white/70">No mutations recorded yet.</div>
        ) : (
          <div className="divide-y divide-white/10">
            {visibleEntries.map((e, idx) => {
              const statusClass = e.ok ? 'text-emerald-300' : 'text-red-300';
              return (
                <div key={`${e.ts}-${idx}`} className="px-4 py-2 text-[12px]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate">
                      <span className="text-white/70">{formatTime(e.ts)}</span>{' '}
                      <span className="font-mono text-white">{e.method}</span>{' '}
                      <span className="text-white/80">{e.path}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-mono ${statusClass}`}>{e.status}</span>
                      <span className="text-white/60">{e.duration_ms}ms</span>
                    </div>
                  </div>
                  {!e.ok && e.error ? (
                    <div className="mt-1 text-red-200/80 break-words">{e.error}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-white/10 text-[11px] text-white/60">
        Enable: <span className="font-mono">localStorage.ddai:showApiMutationsPanel=1</span> or <span className="font-mono">?debugApiMutations=1</span>
      </div>
    </div>
  );
}
