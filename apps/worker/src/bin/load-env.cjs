/**
 * load-env.cjs
 *
 * CJS bootstrap preloaded via `tsx --require ./src/bin/load-env.cjs`.
 * Parses the root .env file and injects variables into process.env
 * BEFORE any module initializes (e.g. before db.ts runs its top-level guard).
 *
 * - Skips any key already present in process.env (CI secrets take precedence).
 * - Silently no-ops if the .env file doesn't exist (CI environments).
 * - Strips wrapping single/double quotes from values.
 * - Ignores comments and blank lines.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const envFile = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    // Never overwrite — CI secrets, shell exports, etc. always win.
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let val = t.slice(eq + 1);
    // Strip wrapping quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
