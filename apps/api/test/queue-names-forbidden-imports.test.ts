import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function walkDir(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip build outputs and deps.
      if (e.name === "node_modules" || e.name === "dist") continue;
      out.push(...walkDir(p));
      continue;
    }
    if (e.isFile()) out.push(p);
  }
  return out;
}

function isTsLike(filePath: string): boolean {
  return filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".js") || filePath.endsWith(".cjs") || filePath.endsWith(".mjs");
}

const FORBIDDEN_IMPORT_RE = /import\s*\{[^}]*\bQUEUE_NAMES\b[^}]*\}\s*from\s*["']@dealdecision\/contracts["']/;

test("PR1 guardrail: API must not import QUEUE_NAMES from @dealdecision/contracts", () => {
  const apiRoot = path.resolve(__dirname, "..");
  const targets = [path.join(apiRoot, "src"), path.join(apiRoot, "test")];

  const offenders: Array<{ file: string; line: string }> = [];

  for (const t of targets) {
    if (!fs.existsSync(t)) continue;
    for (const file of walkDir(t)) {
      if (!isTsLike(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (!FORBIDDEN_IMPORT_RE.test(text)) continue;

      const firstLine = text
        .split(/\r?\n/)
        .find((l) => l.includes("@dealdecision/contracts") && l.includes("QUEUE_NAMES"))
        ?.trim();

      offenders.push({ file: path.relative(apiRoot, file), line: firstLine ?? "<matched forbidden import>" });
    }
  }

  assert.equal(
    offenders.length,
    0,
    `Forbidden QUEUE_NAMES import(s) detected. Import QUEUE_NAMES from @dealdecision/core only.\n` +
      offenders.map((o) => `- ${o.file}: ${o.line}`).join("\n")
  );
});
