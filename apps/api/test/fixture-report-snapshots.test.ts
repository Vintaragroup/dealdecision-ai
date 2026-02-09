import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { VerticalKey } from "../../../packages/core/src/verticals/vertical-contracts";
import { validateReportAgainstContract } from "../../../packages/core/src/verticals/validate-vertical-contract";

type Vertical = VerticalKey;

const normalizeWhitespace = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

const hasToken = (text: string, re: RegExp): boolean => re.test(text);

const safeGet = (obj: any, p: string[]): any => {
  let cur = obj;
  for (const k of p) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
};

const formatViolations = (
  fixtureKey: string,
  violations: { code: string; severity: string; message: string; path?: string }[]
): string => {
  const lines = [`Vertical contract violations for ${fixtureKey}:`];
  for (const v of violations) {
    const p = v.path ? ` @ ${v.path}` : "";
    lines.push(`- [${v.severity}] ${v.code}${p}: ${v.message}`);
  }
  return lines.join("\n");
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const walkFiles = async (root: string): Promise<string[]> => {
  if (!(await fileExists(root))) return [];
  const out: string[] = [];

  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  };

  await walk(root);
  return out;
};

const parseFixtureKey = (regressionsRoot: string, filePath: string): { fixtureKey: string; vertical: Vertical } => {
  const rel = path.relative(regressionsRoot, filePath).split(path.sep).join("/");
  const parts = rel.split("/").filter(Boolean);
  const verticalRaw = parts[0] ?? "other";
  const vertical: Vertical =
    verticalRaw === "real_estate" ||
    verticalRaw === "services" ||
    verticalRaw === "technology" ||
    verticalRaw === "product" ||
    verticalRaw === "healthcare" ||
    verticalRaw === "other"
      ? verticalRaw
      : "other";

  const base = path.basename(filePath).replace(/\.snapshot\.json$/i, "");
  const fixtureKey = `${verticalRaw}/${base}`;
  return { fixtureKey, vertical };
};

const pressTokenRe = /(press\s*release|for\s+immediate\s+release|\bnewsroom\b|\bmedia\s+kit\b|\bpress\b)/i;

const getRevenueRaw = (snapshot: any): string => {
  const raw = safeGet(snapshot, ["structured_summary", "kpis", "revenue", "value_raw"]);
  const v = typeof raw === "string" ? raw : "";
  return normalizeWhitespace(v);
};

const getRevenueLabel = (snapshot: any): string => {
  const label = safeGet(snapshot, ["structured_summary", "kpis", "revenue", "scope_label"]);
  return normalizeWhitespace(typeof label === "string" ? label : "");
};

test("fixture report snapshots: stable invariants", async (t) => {
  const regressionsRoot = path.join(__dirname, "fixtures", "regressions");
  const files = (await walkFiles(regressionsRoot)).filter((p) => p.endsWith(".snapshot.json"));

  if (files.length === 0) {
    t.skip(`No snapshot files found under ${regressionsRoot}`);
    return;
  }

  files.sort((a, b) => a.localeCompare(b));

  for (const fp of files) {
    const { fixtureKey, vertical } = parseFixtureKey(regressionsRoot, fp);
    await t.test(fixtureKey, async () => {
      const raw = await fs.readFile(fp, "utf8");
      const snapshot = JSON.parse(raw);

      const contract = validateReportAgainstContract({ vertical, reportExcerpt: snapshot });
      if (contract.summary.errors > 0) {
        assert.fail(formatViolations(fixtureKey, contract.violations));
      }

      // Global invariants
      const hero = normalizeWhitespace(safeGet(snapshot, ["deal_summary", "tiers", "hero"]));
      const overview = normalizeWhitespace(safeGet(snapshot, ["deal_summary", "tiers", "overview"]));
      const deep = normalizeWhitespace(safeGet(snapshot, ["deal_summary", "tiers", "deep"]));

      assert.ok(hero.length > 0, "tiers.hero must exist");
      assert.ok(overview.length > 0, "tiers.overview must exist");
      assert.ok(deep.length > 0, "tiers.deep must exist");

      assert.notEqual(hero, overview, "tiers.hero and tiers.overview must not be identical");
      assert.notEqual(hero, deep, "tiers.hero and tiers.deep must not be identical");
      assert.notEqual(overview, deep, "tiers.overview and tiers.deep must not be identical");

      // Revenue selection_reason and vertical-specific revenue constraints are covered
      // by validateReportAgainstContract.

      const productDefinition = normalizeWhitespace(
        safeGet(snapshot, ["product_summary", "product_definition"])
      );
      if (productDefinition.length > 0) {
        assert.ok(!hasToken(productDefinition, pressTokenRe), "product_definition must not include press tokens");
      }

      // Diligence minimums and revenue-vs-returns checks are covered by validateReportAgainstContract.
    });
  }
});
