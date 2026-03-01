import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Spacing allowlists
// Both must stay in sync with the comment in apps/web/src/tailwind.input.css.
// To adjust: edit the sets below, then run `pnpm style:drift:update`.
// ---------------------------------------------------------------------------

/**
 * CURRENT: all spacing keys permitted today.
 * Violations against this set = HARD_FAIL (CI breaks on new occurrences).
 * CURRENT is now equal to TARGET — all migration keys (3.5, 7, 11, 13, 14)
 * have been burned down and are no longer allowed.
 */
export const SPACING_ALLOWLIST_CURRENT = new Set([
  "0", "0.5",
  "1", "1.5",
  "2", "2.5",
  "3",
  "4", "5", "6", "8",
  "10", "12", "16",
  "20", "24", "28", "32", "36", "40", "48", "64", "96",
]);

/**
 * TARGET: the strict design-system spacing scale.
 * CURRENT and TARGET are now identical — no active migration window.
 * Keys in CURRENT but NOT in TARGET = MIGRATION (warning only — does not fail CI).
 */
export const SPACING_ALLOWLIST_TARGET = new Set([
  "0", "0.5",
  "1", "1.5",
  "2", "2.5",
  "3",
  "4", "5", "6", "8",
  "10", "12", "16",
  "20", "24", "28", "32", "36", "40", "48", "64", "96",
]);

// ---------------------------------------------------------------------------
// Findings & types
// ---------------------------------------------------------------------------

export type SpacingSeverity = "OK" | "HARD_FAIL" | "MIGRATION";

type Finding = {
  file: string; // workspace-relative
  line: number;
  rule: string;
  match: string; // full token as it appears in source, e.g. "md:gap-9"
  severity?: SpacingSeverity;
  suggestion?: string; // nearest TARGET key for MIGRATION findings
};

type BaselineV1 = {
  version: 1;
  generatedAt: string;
  keys: string[];
};

/** rx-based rule (for color drift checks). */
type RxRule = {
  id: string;
  rx: RegExp;
  filter?: (match: string) => boolean;
};

/**
 * Token-based rule: receives each whitespace-delimited class token from a line
 * (including variant prefixes, e.g. "md:gap-9") and returns a partial Finding
 * or null to skip.
 */
type TokenRule = {
  id: string;
  tokenTest: (token: string) => Omit<Finding, "file" | "line"> | null;
};

type Rule = RxRule | TokenRule;

// ---------------------------------------------------------------------------
// Token normalization helpers
// ---------------------------------------------------------------------------

export type NormalizedToken = {
  /** Full original token as it appears in source, e.g. "dark:md:hover:gap-9". */
  original: string;
  /** Base utility after stripping variants/modifiers, e.g. "gap-9". */
  baseToken: string;
  /** Leading `-` for negative spacing, e.g. "-mt-4" → isNegative=true, baseToken="mt-4". */
  isNegative: boolean;
  /** Whether a leading `!` important marker was present. */
  hadImportant: boolean;
  /** Ordered variant prefixes, e.g. ["dark", "md", "hover"]. */
  variants: string[];
  /**
   * Numeric spacing key extracted from the base token (everything after the
   * last `-`), e.g. "gap-9" → "9". Null if no trailing numeric key.
   */
  spacingKey: string | null;
};

/**
 * Normalizes a Tailwind class token for spacing evaluation.
 * Handles: chained variant prefixes, `!` important, leading `-` negative,
 * and bracket-style variant values (e.g. `data-[state=open]`).
 */
export function normalizeToken(token: string): NormalizedToken {
  let rest = token;
  const variants: string[] = [];

  // Strip chained variant prefixes: "dark:md:hover:gap-9" → ["dark","md","hover"] + "gap-9"
  // Also handles bracket variants: "data-[state=open]:p-4" → ["data-[state=open]"] + "p-4"
  const variantRx = /^((?:\w[\w-]*(?:\[[^\]]*\])?)):(.+)$/;
  let m: RegExpMatchArray | null;
  while ((m = variantRx.exec(rest))) {
    variants.push(m[1]);
    rest = m[2];
  }

  const hadImportant = rest.startsWith("!");
  if (hadImportant) rest = rest.slice(1);

  // Detect leading `-` for negative spacing (e.g. `-mt-4` → `mt-4`)
  const isNegative = rest.startsWith("-") && /^-[a-z]/.test(rest);
  if (isNegative) rest = rest.slice(1);

  // Extract numeric spacing key: last `-<digits>` segment
  const keyMatch = /^[\w-]+-([0-9]+(?:\.[0-9]+)?)$/.exec(rest);
  const spacingKey = keyMatch ? keyMatch[1] : null;

  return { original: token, baseToken: rest, isNegative, hadImportant, variants, spacingKey };
}

/** Classifies a numeric spacing key against the two allowlists. */
export function classifySpacingKey(key: string): SpacingSeverity {
  if (!SPACING_ALLOWLIST_CURRENT.has(key)) return "HARD_FAIL";
  if (!SPACING_ALLOWLIST_TARGET.has(key)) return "MIGRATION";
  return "OK";
}

/** Returns the numerically closest key from SPACING_ALLOWLIST_TARGET. */
export function closestTargetKey(key: string): string {
  const n = parseFloat(key);
  if (Number.isNaN(n)) return key;
  const sorted = [...SPACING_ALLOWLIST_TARGET].map(Number).sort((a, b) => a - b);
  let best = sorted[0];
  for (const k of sorted) {
    if (Math.abs(k - n) < Math.abs(best - n)) best = k;
  }
  return String(best);
}

// ---------------------------------------------------------------------------
// Class token extraction
// ---------------------------------------------------------------------------

/**
 * Splits a source line into individual Tailwind class tokens.
 * Splits on whitespace and string/template/JSX delimiters so that
 * variant-prefixed tokens like `md:gap-9` and `hover:!mb-7` are
 * returned as whole units.
 */
function extractClassTokens(line: string): string[] {
  return line
    .split(/[\s"'`(){},[\]=<>]+/)
    .filter((t) => t.length >= 2 && t.indexOf("//") === -1);
}

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
// NOTE: artifacts/ is gitignored in this repo; keep the baseline tracked.
const DEFAULT_BASELINE_PATH = path.join(WORKSPACE_ROOT, "scripts", "style_drift_baseline.json");

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;

    const eq = a.indexOf("=");
    if (eq !== -1) {
      values[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }

    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
    } else {
      flags.add(key);
    }
  }

  return { flags, values };
}

function toRel(p: string): string {
  return path.relative(WORKSPACE_ROOT, p).split(path.sep).join("/");
}

function makeKey(f: Finding): string {
  const match = f.match.length > 80 ? `${f.match.slice(0, 77)}...` : f.match;
  return `${f.file}:${f.line}:${f.rule}:${match}`;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", "dist", "build", "coverage", ".next", ".turbo", ".git"].includes(ent.name)) continue;
      yield* walk(abs);
      continue;
    }
    if (ent.isFile()) yield abs;
  }
}

function shouldScanFile(absPath: string): boolean {
  const rel = toRel(absPath);
  if (!rel.startsWith("apps/web/src/")) return false;
  if (rel === "apps/web/src/index.css") return false; // generated Tailwind output
  if (rel.startsWith("apps/web/src/build/")) return false;

  const ext = path.extname(rel);
  if (!new Set([".ts", ".tsx", ".css"]).has(ext)) return false;

  return true;
}

function shouldIgnoreRuleForFile(rule: string, relFile: string): boolean {
  // Token sources are allowed to contain literal color values.
  if (rule === "hardcoded-hex" || rule === "rgb-hsl-color") {
    if (relFile === "apps/web/src/styles/globals.css") return true;
    if (relFile === "apps/web/src/styles/theme-overrides.css") return true;
  }
  // shadcn/ui library components legitimately use arbitrary typography values
  // for their own sizing conventions (e.g. text-[0.8rem] in select.tsx).
  if (rule === "tailwind-arbitrary-typography") {
    if (relFile.startsWith("apps/web/src/components/ui/")) return true;
  }
  return false;
}

function getRules(): Rule[] {
  // Spacing utility prefix pattern (reused across both spacing rules).
  // Intentionally excludes positional/size utilities (top, left, w, h, ring,
  // max-w, min-w, inset, translate, rotate, scale, etc.).
  const SPACING_PREFIX_RX = /^(?:scroll-m[xytblr]?|space-[xy]|gap-[xy]|gap|p[xytblr]?|m[xytblr]?)-/;

  return [
    // -----------------------------------------------------------------------
    // Color drift rules (rx-based, unchanged)
    // -----------------------------------------------------------------------
    {
      id: "tailwind-gray",
      // Catch common "hardcoded gray palette" drift in className strings.
      rx: /\b(?:bg|text|border|ring|stroke|fill|from|via|to)-(?:slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g,
    },
    {
      id: "hardcoded-hex",
      rx: /#[0-9a-fA-F]{3,8}\b/g,
    },
    {
      id: "rgb-hsl-color",
      rx: /\b(?:rgba?|hsla?)\(/g,
    },
    // -----------------------------------------------------------------------
    // Spacing scale enforcement (token-based)
    //
    // Evaluated against each class token extracted from the line, so variant-
    // prefixed tokens like `md:gap-9` and `hover:!mb-7` are normalized before
    // classification. Negative spacing (e.g. `-mt-4`) is handled correctly.
    //
    // HARD_FAIL: key not in SPACING_ALLOWLIST_CURRENT  → fails CI
    // MIGRATION: key in CURRENT but not in TARGET      → warning only
    // -----------------------------------------------------------------------
    {
      id: "tailwind-spacing-scale",
      tokenTest(token: string): Omit<Finding, "file" | "line"> | null {
        const { baseToken, spacingKey } = normalizeToken(token);
        if (!spacingKey) return null;
        if (!SPACING_PREFIX_RX.test(baseToken)) return null;
        const severity = classifySpacingKey(spacingKey);
        if (severity === "OK") return null;
        const suggestion = severity === "MIGRATION" ? closestTargetKey(spacingKey) : undefined;
        return { rule: "tailwind-spacing-scale", match: token, severity, suggestion };
      },
    },
    // -----------------------------------------------------------------------
    // Arbitrary-bracket spacing (token-based)
    //
    // Flags explicit-value bracket utilities on spacing prefixes:
    //   - p-[18px], gap-[10rem], mb-[calc(...)], etc.  → HARD_FAIL
    // Positional/structural bracket values are excluded because their
    // prefixes (top, w, ring, translate, max-w, ...) are not in SPACING_PREFIX_RX.
    // -----------------------------------------------------------------------
    {
      id: "tailwind-arbitrary-spacing",
      tokenTest(token: string): Omit<Finding, "file" | "line"> | null {
        const { baseToken } = normalizeToken(token);
        if (!/^(?:scroll-m[xytblr]?|space-[xy]|gap-[xy]|gap|p[xytblr]?|m[xytblr]?)-\[.+\]$/.test(baseToken)) return null;
        return { rule: "tailwind-arbitrary-spacing", match: token, severity: "HARD_FAIL" };
      },
    },
    // -----------------------------------------------------------------------
    // Arbitrary-bracket typography (rx-based)
    //
    // Flags hardcoded pixel/rem/em sizes on typography utilities:
    //   text-[11px]  leading-[1.1]  tracking-[0.02em]  → HARD_FAIL
    //
    // Does NOT flag colour-bracket values: text-[#6366f1] (caught by hardcoded-hex)
    // because the regex requires the value start with a digit.
    //
    // Excluded files: apps/web/src/components/ui/** (shadcn), see shouldIgnoreRuleForFile
    // -----------------------------------------------------------------------
    {
      id: "tailwind-arbitrary-typography",
      rx: /\b(?:text|leading|tracking)-\[\d/g,
    },
  ];
}

async function scanFile(absPath: string, rules: Rule[]): Promise<Finding[]> {
  const rel = toRel(absPath);
  const ext = path.extname(rel);
  const isCode = ext === ".ts" || ext === ".tsx";

  const text = await fs.readFile(absPath, "utf8");
  const lines = text.split(/\r?\n/);

  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    // Extract class tokens once per line (used by token-based rules).
    const tokens = extractClassTokens(lineText);

    for (const rule of rules) {
      if (shouldIgnoreRuleForFile(rule.id, rel)) continue;

      // Keep the initial guardrail focused: only enforce on authored code.
      // (CSS drift can be added later once a stricter token strategy is finalized.)
      if (!isCode && rule.id !== "tailwind-gray") continue;

      if ("tokenTest" in rule) {
        // Token-based rule: evaluate each space-delimited class token.
        for (const token of tokens) {
          const result = rule.tokenTest(token);
          if (result) {
            findings.push({ file: rel, line: i + 1, ...result });
            if (findings.length > 2000) return findings;
          }
        }
      } else {
        // Regex-based rule: run against the full line.
        rule.rx.lastIndex = 0;
        let m: RegExpExecArray | null;
        // eslint-disable-next-line no-cond-assign
        while ((m = rule.rx.exec(lineText))) {
          if (rule.filter && !rule.filter(m[0])) continue;
          findings.push({
            file: rel,
            line: i + 1,
            rule: rule.id,
            match: m[0],
          });
          if (findings.length > 2000) return findings;
        }
      }
    }
  }

  return findings;
}

async function loadBaseline(baselinePath: string): Promise<BaselineV1 | null> {
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    const parsed = JSON.parse(raw) as BaselineV1;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.keys)) return parsed;
    throw new Error("Invalid baseline format");
  } catch (e: any) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return null;
    throw e;
  }
}

function formatFindings(findings: Finding[]): string {
  const lines: string[] = [];
  for (const f of findings.slice(0, 200)) {
    const sevNote = f.severity && f.severity !== "OK" ? `  [${f.severity}]` : "";
    const suggestNote = f.suggestion ? `  → suggest: ${f.suggestion}` : "";
    lines.push(`${f.file}:${f.line}  ${f.rule}  ${f.match}${sevNote}${suggestNote}`);
  }
  if (findings.length > 200) {
    lines.push(`...and ${findings.length - 200} more`);
  }
  return lines.join("\n");
}

function formatMigrations(findings: Finding[]): string {
  const lines: string[] = [];
  for (const f of findings.slice(0, 100)) {
    const suggestNote = f.suggestion ? `  → suggest: ${f.suggestion}` : "";
    lines.push(`  ${f.file}:${f.line}  ${f.match}${suggestNote}`);
  }
  if (findings.length > 100) {
    lines.push(`  ...and ${findings.length - 100} more`);
  }
  return lines.join("\n");
}

const SPACING_RULE_IDS = new Set(["tailwind-spacing-scale", "tailwind-arbitrary-spacing"]);

function printSummaryTable(params: {
  allRuleIds: string[];
  hardFindings: Finding[];
  newHardFindings: Finding[];
  migrationFindings: Finding[];
  scopeLabel?: string;
  onlyFilter?: string;
}) {
  const { allRuleIds, hardFindings, newHardFindings, migrationFindings, scopeLabel, onlyFilter } = params;

  const totalByRule = new Map<string, number>();
  const newByRule = new Map<string, number>();
  for (const f of hardFindings) totalByRule.set(f.rule, (totalByRule.get(f.rule) ?? 0) + 1);
  for (const f of newHardFindings) newByRule.set(f.rule, (newByRule.get(f.rule) ?? 0) + 1);

  const rows = allRuleIds
    .map((id) => ({ id, total: totalByRule.get(id) ?? 0, newCount: newByRule.get(id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const RULE_COL = 36;
  const LINE_W = RULE_COL + 22;
  const divider = "─".repeat(LINE_W);
  const title = " Style Drift Summary ";
  const lpad = Math.max(0, Math.floor((LINE_W - title.length) / 2));

  process.stdout.write("\n" + "─".repeat(lpad) + title + "─".repeat(LINE_W - lpad - title.length) + "\n");

  if (scopeLabel || onlyFilter) {
    const parts: string[] = [];
    if (scopeLabel) parts.push(`scope: ${scopeLabel}`);
    if (onlyFilter) parts.push(`rules: ${onlyFilter}`);
    process.stdout.write(`  ${parts.join("  │  ")}\n`);
    process.stdout.write(divider + "\n");
  }

  process.stdout.write(`  ${"Rule".padEnd(RULE_COL)}${"Total".padStart(7)}  ${"New".padStart(5)}\n`);
  process.stdout.write(divider + "\n");

  for (const row of rows) {
    const newStr = row.newCount > 0 ? `+${row.newCount}` : "+0";
    const annot =
      row.newCount > 0 ? "  ✗ NEW" :
      (SPACING_RULE_IDS.has(row.id) && row.total === 0) ? "  ✓ spacing clean" : "";
    process.stdout.write(`  ${row.id.padEnd(RULE_COL)}${String(row.total).padStart(7)}  ${newStr.padStart(5)}${annot}\n`);
  }

  process.stdout.write(divider + "\n");
  const migStr = migrationFindings.length > 0 ? `  │  migration: ${migrationFindings.length}` : "";
  const statusLabel = newHardFindings.length === 0 ? "✓ OK" : "✗ FAIL";
  process.stdout.write(`  total hard: ${hardFindings.length}  │  new: ${newHardFindings.length}${migStr}  │  ${statusLabel}\n`);
  process.stdout.write("─".repeat(LINE_W) + "\n\n");
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));

  const baselinePath = path.resolve(WORKSPACE_ROOT, values.baseline || DEFAULT_BASELINE_PATH);
  const update = flags.has("update");

  // ---------------------------------------------------------------------------
  // --scope <dir>  Scan only this directory instead of the default apps/web/src.
  //               Accepts absolute paths or workspace-relative paths.
  //               Example: --scope apps/web/src/components/workspace
  // ---------------------------------------------------------------------------
  const scopeArg = values["scope"];
  const scanRoot = scopeArg
    ? (path.isAbsolute(scopeArg) ? scopeArg : path.resolve(WORKSPACE_ROOT, scopeArg))
    : path.join(WORKSPACE_ROOT, "apps", "web", "src");
  const scopeLabel = scopeArg ? path.relative(WORKSPACE_ROOT, scanRoot).split(path.sep).join("/") : undefined;

  // ---------------------------------------------------------------------------
  // --only <rule1,rule2>  Run only the named rules (comma-separated).
  //               Cannot be combined with --update (would corrupt baseline).
  //               Example: --only tailwind-spacing-scale,tailwind-arbitrary-spacing
  // ---------------------------------------------------------------------------
  const onlyArg = values["only"];
  const onlySet = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;

  if (update && onlySet) {
    console.error("Cannot use --update with --only: would produce an incomplete baseline.\nRun without --only to update.");
    process.exit(1);
  }

  const allRules = getRules();
  const rules = onlySet ? allRules.filter((r) => onlySet.has(r.id)) : allRules;

  if (onlySet && rules.length === 0) {
    console.error(
      `No rules matched --only "${onlyArg}".\nAvailable rules: ${allRules.map((r) => r.id).join(", ")}`,
    );
    process.exit(1);
  }

  const allFindings: Finding[] = [];

  for await (const abs of walk(scanRoot)) {
    if (!shouldScanFile(abs)) continue;
    const f = await scanFile(abs, rules);
    allFindings.push(...f);
  }

  allFindings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.match.localeCompare(b.match);
  });

  // HARD_FAIL findings are subject to baseline gating and can fail CI.
  // MIGRATION findings are warnings only — they never enter the baseline and
  // never cause CI to fail. This lets us ratchet toward TARGET incrementally.
  const hardFindings = allFindings.filter((f) => f.severity !== "MIGRATION");
  const migrationFindings = allFindings.filter((f) => f.severity === "MIGRATION");

  if (update) {
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    // MIGRATION findings are intentionally excluded from the baseline so they
    // remain a live count that cannot be silently grandfathered.
    const baseline: BaselineV1 = {
      version: 1,
      generatedAt: new Date().toISOString(),
      keys: hardFindings.map(makeKey),
    };
    await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    console.log(
      `Updated style drift baseline: ${toRel(baselinePath)} ` +
        `(${hardFindings.length} hard findings; ${migrationFindings.length} migration warnings excluded)`,
    );
    return;
  }

  const baseline = await loadBaseline(baselinePath);
  if (!baseline) {
    console.error(`Missing style drift baseline at ${toRel(baselinePath)}.`);
    console.error("Run: pnpm style:drift:update");
    process.exit(2);
  }

  const baselineSet = new Set(baseline.keys);
  const newHardFindings = hardFindings.filter((f) => !baselineSet.has(makeKey(f)));

  // Show new findings grouped by rule before the summary table.
  if (newHardFindings.length > 0) {
    process.stderr.write("\nNew style drift findings detected:\n\n");
    const byRule = new Map<string, Finding[]>();
    for (const f of newHardFindings) {
      if (!byRule.has(f.rule)) byRule.set(f.rule, []);
      byRule.get(f.rule)!.push(f);
    }
    for (const [rule, rFindings] of byRule) {
      process.stderr.write(`  [${rule}] — ${rFindings.length} new finding(s):\n`);
      process.stderr.write(formatFindings(rFindings.slice(0, 10)) + "\n");
      if (rFindings.length > 10) {
        process.stderr.write(`  ...and ${rFindings.length - 10} more in this rule\n`);
      }
      process.stderr.write("\n");
    }
    process.stderr.write("Fix by switching to design-system tokens/utilities, or (if intentional) update baseline:\n");
    process.stderr.write("  pnpm style:drift:update\n");
  }

  // Migration warnings: always shown, never fatal.
  if (migrationFindings.length > 0) {
    process.stderr.write(
      `\nMIGRATION WARNINGS: ${migrationFindings.length} spacing token(s) are in CURRENT but not in TARGET allowlist.\n` +
        "These do not fail CI. Migrate toward SPACING_ALLOWLIST_TARGET over time:\n" +
        formatMigrations(migrationFindings) +
        "\n\nSee docs/Active/webapp-ui/DESIGN_SYSTEM.md for migration guidance.\n\n",
    );
  }

  // Always print the summary table (stdout) so spacing health is visible even
  // when the color-drift baseline dominates the hard-findings count.
  printSummaryTable({
    allRuleIds: rules.map((r) => r.id),
    hardFindings,
    newHardFindings,
    migrationFindings,
    scopeLabel,
    onlyFilter: onlyArg,
  });

  if (newHardFindings.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
