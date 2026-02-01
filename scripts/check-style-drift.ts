import fs from "node:fs/promises";
import path from "node:path";

type Finding = {
  file: string; // workspace-relative
  line: number;
  rule: string;
  match: string;
};

type BaselineV1 = {
  version: 1;
  generatedAt: string;
  keys: string[];
};

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
  return false;
}

function getRules() {
  return [
    {
      id: "tailwind-gray",
      // Catch common “hardcoded gray palette” drift in className strings.
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
  ] as const;
}

async function scanFile(absPath: string): Promise<Finding[]> {
  const rel = toRel(absPath);
  const ext = path.extname(rel);
  const isCode = ext === ".ts" || ext === ".tsx";

  const text = await fs.readFile(absPath, "utf8");
  const lines = text.split(/\r?\n/);

  const findings: Finding[] = [];
  const rules = getRules();

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];

    for (const rule of rules) {
      if (shouldIgnoreRuleForFile(rule.id, rel)) continue;

      // Keep the initial guardrail focused: only enforce on authored code.
      // (CSS drift can be added later once a stricter token strategy is finalized.)
      if (!isCode && rule.id !== "tailwind-gray") continue;

      rule.rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((m = rule.rx.exec(lineText))) {
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
    lines.push(`${f.file}:${f.line}  ${f.rule}  ${f.match}`);
  }
  if (findings.length > 200) {
    lines.push(`...and ${findings.length - 200} more`);
  }
  return lines.join("\n");
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));

  const baselinePath = path.resolve(WORKSPACE_ROOT, values.baseline || DEFAULT_BASELINE_PATH);
  const update = flags.has("update");

  const allFindings: Finding[] = [];

  for await (const abs of walk(path.join(WORKSPACE_ROOT, "apps", "web", "src"))) {
    if (!shouldScanFile(abs)) continue;
    const f = await scanFile(abs);
    allFindings.push(...f);
  }

  allFindings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.match.localeCompare(b.match);
  });

  const keys = allFindings.map(makeKey);

  if (update) {
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    const baseline: BaselineV1 = { version: 1, generatedAt: new Date().toISOString(), keys };
    await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    console.log(`Updated style drift baseline: ${toRel(baselinePath)} (${keys.length} findings)`);
    return;
  }

  const baseline = await loadBaseline(baselinePath);
  if (!baseline) {
    console.error(`Missing style drift baseline at ${toRel(baselinePath)}.`);
    console.error("Run: pnpm style:drift:update");
    process.exit(2);
  }

  const baselineSet = new Set(baseline.keys);
  const newFindings = allFindings.filter((f) => !baselineSet.has(makeKey(f)));

  if (newFindings.length > 0) {
    console.error("New style drift findings detected (hardcoded colors/gray palette):\n");
    console.error(formatFindings(newFindings));
    console.error("\nFix by switching to tokens/utilities, or (if intentional) update baseline:");
    console.error("  pnpm style:drift:update");
    process.exit(1);
  }

  console.log(`Style drift check OK (${keys.length} findings; 0 new vs baseline).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
