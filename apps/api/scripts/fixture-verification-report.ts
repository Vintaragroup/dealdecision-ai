import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { VerticalKey } from '../../../packages/core/src/verticals/vertical-contracts';
import { validateReportAgainstContract } from '../../../packages/core/src/verticals/validate-vertical-contract';

type AnyRecord = Record<string, any>;

const DASH = '—';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursively(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(entryPath)));
      continue;
    }
    if (entry.isFile()) results.push(entryPath);
  }

  return results;
}

function mdEscapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br/>');
}

function fmtCell(value: unknown): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'string' && value.trim() === '') return DASH;
  return mdEscapeCell(String(value));
}

function includesPlaceholder(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return text.includes('Key details are pending') || text.includes('This is a company in');
}

function safeStringLength(text: unknown): number {
  if (typeof text !== 'string') return 0;
  return text.length;
}

function pickFixtureKey(meta: AnyRecord | null, snapshot: AnyRecord, relNoExt: string): string {
  return (
    meta?.fixture_key ??
    snapshot?.fixture_key ??
    snapshot?.debug?.fixture_key ??
    relNoExt
  );
}

function pickVertical(meta: AnyRecord | null, relNoExt: string): string {
  if (typeof meta?.vertical === 'string' && meta.vertical.trim() !== '') return meta.vertical;
  const firstSegment = relNoExt.split('/')[0];
  return firstSegment || 'unknown';
}

function normalizeVerticalKey(raw: string): VerticalKey {
  return raw === 'product' ||
    raw === 'technology' ||
    raw === 'services' ||
    raw === 'real_estate' ||
    raw === 'healthcare' ||
    raw === 'other'
    ? raw
    : 'other';
}

function toTopFlags(flags: string[], max = 3): string {
  if (flags.length === 0) return DASH;
  return flags.slice(0, max).join(', ');
}

async function main() {
  const regressionsRoot = path.resolve(__dirname, '..', 'test', 'fixtures', 'regressions');
  const outPath = path.join(regressionsRoot, 'VERIFICATION_REPORT.md');

  const allFiles = await listFilesRecursively(regressionsRoot);
  const snapshotPaths = allFiles
    .filter((p) => p.endsWith('.snapshot.json'))
    .sort((a, b) => a.localeCompare(b));

  if (snapshotPaths.length === 0) {
    throw new Error(`No *.snapshot.json files found under: ${regressionsRoot}`);
  }

  const fixtures: Array<{
    fixtureKey: string;
    vertical: string;
    relPathNoExt: string;
    snapshotPath: string;
    metaPath: string;
    snapshot: AnyRecord;
    meta: AnyRecord;
    archetypeKey: string;
    archetypeConfidence: number | null;
    citationsTotalSources: number;
    citationsUniquePages: number;
    tiers: { hero: string | null; overview: string | null; deep: string | null };
    tierCharCounts: { hero: number; overview: number; deep: number };
    kpis: AnyRecord;
    redFlags: string[];
    contractErrors: number;
    contractWarns: number;
    contractViolations: Array<{ code: string; severity: 'error' | 'warn'; message: string; path?: string; evidence?: any }>;
  }> = [];

  for (const snapshotPath of snapshotPaths) {
    const metaPath = snapshotPath.replace(/\.snapshot\.json$/u, '.meta.json');
    if (!(await pathExists(metaPath))) {
      throw new Error(`Missing paired meta for snapshot: ${snapshotPath}`);
    }

    const relSnapshot = path
      .relative(regressionsRoot, snapshotPath)
      .split(path.sep)
      .join('/');
    const relPathNoExt = relSnapshot.replace(/\.snapshot\.json$/u, '');

    const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8')) as AnyRecord;
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as AnyRecord;

    const fixtureKey = pickFixtureKey(meta, snapshot, relPathNoExt);
    const vertical = pickVertical(meta, relPathNoExt);
    const verticalKey = normalizeVerticalKey(vertical);

    const archetypeKey =
      snapshot?.debug?.deck_archetype_key ??
      meta?.deck_archetype_key ??
      'unknown';

    const archetypeConfidence =
      typeof snapshot?.debug?.archetype_confidence === 'number'
        ? snapshot.debug.archetype_confidence
        : null;

    const citationsTotalSources = Number(snapshot?.citations?.total_sources ?? 0);
    const citationsUniquePages = Number(snapshot?.citations?.unique_pages ?? 0);

    const tiers = {
      hero: (snapshot?.deal_summary?.tiers?.hero ?? null) as string | null,
      overview: (snapshot?.deal_summary?.tiers?.overview ?? null) as string | null,
      deep: (snapshot?.deal_summary?.tiers?.deep ?? null) as string | null
    };

    const tierCharCounts = {
      hero:
        typeof snapshot?.deal_summary?.tier_char_counts?.hero === 'number'
          ? snapshot.deal_summary.tier_char_counts.hero
          : safeStringLength(tiers.hero),
      overview:
        typeof snapshot?.deal_summary?.tier_char_counts?.overview === 'number'
          ? snapshot.deal_summary.tier_char_counts.overview
          : safeStringLength(tiers.overview),
      deep:
        typeof snapshot?.deal_summary?.tier_char_counts?.deep === 'number'
          ? snapshot.deal_summary.tier_char_counts.deep
          : safeStringLength(tiers.deep)
    };

    const kpis = (snapshot?.structured_summary?.kpis ?? {}) as AnyRecord;

    const contract = validateReportAgainstContract({ vertical: verticalKey, reportExcerpt: snapshot });

    const redFlags: string[] = [];

    if (archetypeKey === 'unknown') redFlags.push('archetype_key === "unknown"');
    if (citationsTotalSources === 0) redFlags.push('citations.total_sources === 0');

    if (includesPlaceholder(tiers.hero) || includesPlaceholder(tiers.overview) || includesPlaceholder(tiers.deep)) {
      redFlags.push('deal_summary tiers contain placeholder phrasing');
    }

    const kpiRevenueValueRaw = kpis?.revenue?.value_raw ?? null;
    const kpiCustomersValueRaw = kpis?.customers?.value_raw ?? null;
    const kpiGrowthValueRaw = kpis?.growth?.value_raw ?? null;

    if (kpiRevenueValueRaw === null) redFlags.push('kpis.revenue.value_raw is null');
    if (kpiCustomersValueRaw === null) redFlags.push('kpis.customers.value_raw is null');
    if (kpiGrowthValueRaw === null) redFlags.push('kpis.growth.value_raw is null');

    const slideTitles = [
      kpis?.raise?.source?.slide_title ?? null,
      kpis?.revenue?.source?.slide_title ?? null,
      kpis?.customers?.source?.slide_title ?? null,
      kpis?.growth?.source?.slide_title ?? null
    ];

    if (slideTitles.some((t) => t === null)) {
      redFlags.push('kpi source.slide_title is null');
    }

    fixtures.push({
      fixtureKey,
      vertical,
      relPathNoExt,
      snapshotPath,
      metaPath,
      snapshot,
      meta,
      archetypeKey,
      archetypeConfidence,
      citationsTotalSources,
      citationsUniquePages,
      tiers,
      tierCharCounts,
      kpis,
      redFlags,
      contractErrors: contract.summary.errors,
      contractWarns: contract.summary.warns,
      contractViolations: contract.violations
    });
  }

  fixtures.sort((a, b) => a.fixtureKey.localeCompare(b.fixtureKey));

  const lines: string[] = [];
  lines.push('# Fixture Verification Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| fixture | vertical | red_flag_count | top flags |');
  lines.push('| --- | --- | ---: | --- |');
  for (const f of fixtures) {
    lines.push(
      `| ${mdEscapeCell(f.fixtureKey)} | ${mdEscapeCell(f.vertical)} | ${f.redFlags.length} | ${mdEscapeCell(toTopFlags(f.redFlags))} |`
    );
  }

  for (const f of fixtures) {
    lines.push('');
    lines.push(`## ${f.fixtureKey}`);
    lines.push('');

    const conf = f.archetypeConfidence === null ? DASH : String(f.archetypeConfidence);
    lines.push(`- Deck archetype: ${fmtCell(f.archetypeKey)} (confidence: ${fmtCell(conf)})`);
    lines.push(
      `- Citations: total_sources=${fmtCell(f.citationsTotalSources)}, unique_pages=${fmtCell(f.citationsUniquePages)}`
    );
    lines.push('');

    lines.push('**Deal summary tiers**');
    lines.push('');
    lines.push(`- hero (${f.tierCharCounts.hero} chars): ${fmtCell(f.tiers.hero)}`);
    lines.push(`- overview (${f.tierCharCounts.overview} chars): ${fmtCell(f.tiers.overview)}`);
    lines.push(`- deep (${f.tierCharCounts.deep} chars): ${fmtCell(f.tiers.deep)}`);
    lines.push('');

    lines.push('**KPIs**');
    lines.push('');
    lines.push('| kpi | value_raw | scope_label | selection_reason | source page | source title |');
    lines.push('| --- | --- | --- | --- | ---: | --- |');

    const kpiKeys = ['raise', 'revenue', 'customers', 'growth'] as const;
    for (const kpiKey of kpiKeys) {
      const kpi = f.kpis?.[kpiKey] ?? null;
      const sourcePage = kpi?.source?.page ?? null;
      const sourceTitle = kpi?.source?.slide_title ?? null;
      lines.push(
        `| ${kpiKey} | ${fmtCell(kpi?.value_raw ?? null)} | ${fmtCell(kpi?.scope_label ?? null)} | ${fmtCell(
          kpi?.selection_reason ?? null
        )} | ${fmtCell(sourcePage)} | ${fmtCell(sourceTitle)} |`
      );
    }

    lines.push('');
    lines.push('**Red flags**');
    lines.push('');

    if (f.redFlags.length === 0) {
      lines.push(`- ${DASH}`);
    } else {
      for (const flag of f.redFlags) lines.push(`- ${mdEscapeCell(flag)}`);
    }

    lines.push('');
    lines.push('**Vertical Contract Compliance**');
    lines.push('');
    lines.push(`- Errors: ${f.contractErrors}, Warns: ${f.contractWarns}`);
    lines.push('');
    if (f.contractViolations.length === 0) {
      lines.push(`- ${DASH}`);
    } else {
      for (const v of f.contractViolations) {
        const pathPart = v.path ? ` @ ${v.path}` : '';
        const evidencePart = v.evidence ? ` evidence=${mdEscapeCell(JSON.stringify(v.evidence))}` : '';
        lines.push(`- [${v.severity}] ${mdEscapeCell(v.code)}${mdEscapeCell(pathPart)}: ${mdEscapeCell(v.message)}${evidencePart}`);
      }
    }
  }

  lines.push('');
  const markdown = lines.join('\n');

  await fs.writeFile(outPath, markdown, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote verification report: ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
