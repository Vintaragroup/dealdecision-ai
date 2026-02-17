import { computeOverviewTruthTableDiff } from './overview-truth-table-comparator';

type Json = any;

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  return '';
}

function winnerChainForField(d: ReturnType<typeof computeOverviewTruthTableDiff>[number]): string {
  const parts: string[] = [];
  parts.push(`overlay:${d.runtime_overlay_source ?? 'n/a'}`);
  if (d.runtime_overlay_value) parts.push('overlay_value=yes');
  else parts.push('overlay_value=no');

  if (d.runtime_det_value) parts.push('det_value=yes');
  else parts.push('det_value=no');

  parts.push(`expected:${d.expected_source}`);
  return parts.join(' → ');
}

function expectedChainForField(d: ReturnType<typeof computeOverviewTruthTableDiff>[number]): string {
  if (d.field === 'hero_summary') {
    return 'overlay.one_liner → overlay.summary_text → report.tiers.overview → report.tiers.hero → missing';
  }
  if (d.field === 'strengths' || d.field === 'concerns' || d.field === 'open_questions' || d.field === 'traction') {
    return 'overlay.list(governed_ui_copy_v1) → overlay.list(deterministic-in-overlay) → missing';
  }
  return 'overlay(governed) → report(det if display-safe) → overlay(any) → report(any) → missing';
}

function mdEscapeInline(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
}

function suspectsToMd(suspects: string[]): string {
  if (!suspects.length) return '';
  return mdEscapeInline(suspects.join('\n'));
}

async function fetchJson(url: string): Promise<Json> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  return { res, json } as any;
}

async function main() {
  const dealId = process.env.DEAL_ID || process.argv.find((a) => a.startsWith('--deal-id='))?.split('=')[1];
  const apiBaseUrl = process.env.API_BASE_URL || process.argv.find((a) => a.startsWith('--api-base-url='))?.split('=')[1] || 'http://localhost:9001';

  if (!dealId) {
    console.error('Missing DEAL_ID. Usage: DEAL_ID=<uuid> pnpm tsx scripts/generate-overview-runtime-vs-truth-table-report.ts');
    process.exit(2);
  }

  const overlay = await fetchJson(`${apiBaseUrl}/api/v1/deals/${dealId}/governed-llm-overview`);
  const report = await fetchJson(`${apiBaseUrl}/api/v1/deals/${dealId}/report`);

  const diffs = computeOverviewTruthTableDiff({ governedOverlayJson: (overlay as any).json, reportJson: (report as any).json });

  const overlayHttpStatus = (overlay as any).res?.status;
  const reportHttpStatus = (report as any).res?.status;

  const overlaySkipReason =
    asString((overlay as any).json?.overview?.overview_json?.phase1?.governed_ui_copy_v1_quality?.skipped_reason) ||
    asString((overlay as any).json?.overview?.overview_json?.display_facts_v1_quality?.skipped_reason) ||
    '';

  const lines: string[] = [];
  lines.push('# Overview runtime vs truth table diff');
  lines.push('');
  lines.push(`- Deal: ${dealId}`);
  lines.push(`- API base: ${apiBaseUrl}`);
  lines.push(`- Overlay HTTP: ${overlayHttpStatus}`);
  lines.push(`- Report HTTP: ${reportHttpStatus}`);
  if (overlaySkipReason) lines.push(`- Overlay skipped_reason: ${overlaySkipReason}`);
  lines.push('');

  lines.push('| Field | Expected chain (winner) | Runtime chain | Divergence | Suspect roots |');
  lines.push('|---|---|---|---|---|');

  for (const d of diffs) {
    const expectedWinner = `${expectedChainForField(d)} (winner=${d.expected_source}: ${mdEscapeInline(d.expected_value)})`;
    const runtimeChain = mdEscapeInline(winnerChainForField(d));
    const divergence = d.divergence_category;
    const suspects = divergence === 'NONE' ? '' : suspectsToMd(d.likely_root_files);
    lines.push(`| ${d.field} | ${expectedWinner} | ${runtimeChain} | ${divergence} | ${suspects} |`);
  }

  lines.push('');
  lines.push('## Divergence categories');
  lines.push('');
  lines.push('- `CONTRACT_MISMATCH`: endpoint response shape/status differs from expected contract (missing overlay must be `200 {overview:null}`).');
  lines.push('- `PRODUCER_SKIPPED_GOVERNED`: producer emitted governed schema but skipped evidence-backed fields (`skipped_reason=no_evidence`).');
  lines.push('- `EVIDENCE_MISSING`: UI expected evidence refs/ids for governed fields but none were present (even if text exists).');
  lines.push('- `DETERMINISTIC_OVERRIDE`: deterministic candidate was chosen because governed was missing/empty or deterministic was displayable while overlay text was not.');
  lines.push('- `UI_WIRING`: expected value differs from what UI renders due to wiring/transform mismatch (requires UI observation).');
  lines.push('- `VERIFICATION_GAP`: comparator can’t decide without additional capture (UI screenshot, logs, or payload).');

  process.stdout.write(lines.join('\n') + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
