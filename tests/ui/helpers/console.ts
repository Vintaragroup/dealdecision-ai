import type { Page } from '@playwright/test';

export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
}

export interface PageErrorEntry {
  message: string;
  stack: string;
  timestamp: number;
}

export interface ConsoleLog {
  messages: ConsoleEntry[];
  errors: PageErrorEntry[];
}

/**
 * Attaches console and page-error listeners to a Playwright page.
 * Returns a log object populated as the page runs.
 *
 * Warning/error console messages are always printed to stdout regardless of verbosity.
 *
 * @example
 *   const console_ = attachConsoleLogger(page);
 *   await page.goto('/app');
 *   printConsoleSummary(console_);
 */
export function attachConsoleLogger(
  page: Page,
  options: { verbose?: boolean } = {},
): ConsoleLog {
  const { verbose = false } = options;
  const log: ConsoleLog = { messages: [], errors: [] };

  page.on('console', (msg) => {
    const entry: ConsoleEntry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    };
    log.messages.push(entry);

    if (verbose || msg.type() === 'error' || msg.type() === 'warning') {
      const prefix =
        msg.type() === 'error'
          ? '[console.error]'
          : msg.type() === 'warning'
            ? '[console.warn] '
            : '[console]      ';
      console.log(`${prefix} ${msg.text()}`);
    }
  });

  page.on('pageerror', (err: Error) => {
    const entry: PageErrorEntry = {
      message: err.message,
      stack: err.stack ?? '',
      timestamp: Date.now(),
    };
    log.errors.push(entry);
    console.error(`[page error] ${err.message}\n${err.stack ?? ''}`);
  });

  return log;
}

/**
 * Prints a summary of console errors and page errors.
 * Call this at the end of a spec to surface issues even when running headless.
 */
export function printConsoleSummary(log: ConsoleLog): void {
  const errors = log.messages.filter((m) => m.type === 'error');
  const warnings = log.messages.filter((m) => m.type === 'warning');

  console.log('\n────────────── Console Summary ──────────────');
  console.log(`  ${errors.length} error(s), ${warnings.length} warning(s), ${log.errors.length} page error(s)`);

  if (errors.length > 0) {
    console.log('\n  Console errors:');
    for (const e of errors) console.log(`    • ${e.text}`);
  }

  if (log.errors.length > 0) {
    console.log('\n  Page (JS) errors:');
    for (const e of log.errors) {
      console.log(`    • ${e.message}`);
      if (e.stack) console.log(`      ${e.stack.split('\n')[1] ?? ''}`);
    }
  }
  console.log('─────────────────────────────────────────────\n');
}
