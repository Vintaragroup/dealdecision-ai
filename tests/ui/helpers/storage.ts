import type { Page } from '@playwright/test';

export interface BrowserStorageDump {
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
}

/**
 * Dumps the contents of localStorage and sessionStorage from the current page context.
 * Values that are valid JSON are parsed; others are returned as raw strings.
 */
export async function dumpBrowserStorage(page: Page): Promise<BrowserStorageDump> {
  return page.evaluate(() => {
    function readStorage(storage: Storage): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        const raw = storage.getItem(key);
        if (raw == null) continue;
        try {
          result[key] = JSON.parse(raw);
        } catch {
          result[key] = raw;
        }
      }
      return result;
    }
    return {
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
    };
  });
}

/**
 * Prints a human-readable summary of browser storage to stdout.
 * Redacts values whose key names contain 'token', 'secret', or 'key' (case-insensitive).
 */
export function printStorageSummary(dump: BrowserStorageDump): void {
  const REDACT_PATTERN = /token|secret|key/i;

  function formatEntry(key: string, value: unknown): string {
    if (REDACT_PATTERN.test(key)) return '[REDACTED]';
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value).slice(0, 120) + (JSON.stringify(value).length > 120 ? '…' : '');
    }
    return String(value).slice(0, 120);
  }

  console.log('\n────────────── localStorage ──────────────');
  const lsKeys = Object.keys(dump.localStorage);
  if (lsKeys.length === 0) {
    console.log('  (empty)');
  } else {
    for (const k of lsKeys) {
      console.log(`  ${k}: ${formatEntry(k, dump.localStorage[k])}`);
    }
  }

  console.log('\n────────────── sessionStorage ──────────────');
  const ssKeys = Object.keys(dump.sessionStorage);
  if (ssKeys.length === 0) {
    console.log('  (empty)');
  } else {
    for (const k of ssKeys) {
      console.log(`  ${k}: ${formatEntry(k, dump.sessionStorage[k])}`);
    }
  }
  console.log('────────────────────────────────────────────\n');
}
