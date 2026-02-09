import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

type SmokeConfig = {
  apiBaseUrl: string;
  dealId: string;
  version?: string;
  authHeader?: { name: string; value: string };
  narrate: boolean;
};

function loadEnv() {
  // Load env from monorepo root first; fallback to app-local .env if present.
  const rootEnvPath = path.resolve(__dirname, '../../../.env');
  const rootEnvLocalPath = path.resolve(__dirname, '../../../.env.local');
  const appEnvPath = path.resolve(__dirname, '../../.env');
  const appEnvLocalPath = path.resolve(__dirname, '../../.env.local');

  for (const p of [rootEnvPath, rootEnvLocalPath, appEnvPath, appEnvLocalPath]) {
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function parseHeaderLine(line: string | undefined): { name: string; value: string } | undefined {
  if (!line) return undefined;
  const idx = line.indexOf(':');
  if (idx <= 0) return undefined;
  const name = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (!name || !value) return undefined;
  return { name, value };
}

function redactMiddle(value: string, maxLen: number = 160): string {
  const s = String(value);
  if (s.length <= maxLen) return s;
  const head = s.slice(0, Math.max(40, Math.floor(maxLen * 0.65)));
  const tail = s.slice(-Math.max(20, Math.floor(maxLen * 0.2)));
  return `${head}…${tail}`;
}

async function fetchJson(url: string, opts: { headers?: Record<string, string> } = {}) {
  const res = await fetch(url, { headers: opts.headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

function buildConfig(): SmokeConfig {
  const args = parseArgs(process.argv.slice(2));

  const apiBaseUrl = args['api-base-url'] || process.env.API_BASE_URL || 'http://localhost:9000';
  const dealId = args['deal-id'] || process.env.DEAL_ID || '';
  const version = args['version'] || process.env.REPORT_VERSION || undefined;
  const authHeader = parseHeaderLine(args['auth-header'] || process.env.API_AUTH_HEADER);
  const narrate = !(args['no-narrate'] === 'true');

  if (!dealId || dealId.trim().length === 0) {
    throw new Error('Missing required --deal-id <uuid> (or DEAL_ID env var)');
  }

  return {
    apiBaseUrl,
    dealId: dealId.trim(),
    version,
    authHeader,
    narrate,
  };
}

function pickNarration(payload: any): any | null {
  const direct = payload?.llm_narration_v1;
  if (direct && typeof direct === 'object') return direct;
  const nested = payload?.report?.llm_narration_v1;
  if (nested && typeof nested === 'object') return nested;
  return null;
}

function pickMetadata(payload: any): any | null {
  const m1 = payload?.metadata;
  if (m1 && typeof m1 === 'object') return m1;
  const m2 = payload?.report?.metadata;
  if (m2 && typeof m2 === 'object') return m2;
  return null;
}

async function main() {
  loadEnv();
  const cfg = buildConfig();

  const endpointPath = cfg.version
    ? `/api/v1/deals/${cfg.dealId}/report/${encodeURIComponent(cfg.version)}`
    : `/api/v1/deals/${cfg.dealId}/report`;

  const url = new URL(endpointPath, cfg.apiBaseUrl);
  if (cfg.narrate) url.searchParams.set('narrate', '1');

  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.authHeader) headers[cfg.authHeader.name] = cfg.authHeader.value;

  console.log(`[narration-smoke] GET ${url.toString()}`);

  const res = await fetchJson(url.toString(), { headers });
  if (!res.ok) {
    console.error(`[narration-smoke] HTTP ${res.status}`);
    console.error(redactMiddle(res.text || ''));
    process.exit(1);
  }

  const payload = res.json;
  const narration = pickNarration(payload);
  const meta = pickMetadata(payload);

  const err = meta?.llm_narration_v1_error ?? null;
  const errCode = typeof err?.code === 'string' ? err.code : null;
  const violations = Array.isArray(err?.guard_violations) ? err.guard_violations : [];

  const sections = narration?.sections;
  const sectionCount = Array.isArray(sections) ? sections.length : 0;

  console.log(`[narration-smoke] status=${res.status} has_narration=${!!narration} sections=${sectionCount} error_code=${errCode ?? 'none'}`);

  if (narration && typeof narration === 'object') {
    console.log(`[narration-smoke] version=${String(narration.version ?? '')}`);
    if (typeof narration.summary === 'string') {
      console.log(`[narration-smoke] summary=${redactMiddle(narration.summary)}`);
    }

    if (Array.isArray(sections)) {
      for (const [i, s] of sections.entries()) {
        const title = typeof s?.title === 'string' ? s.title : `section_${i + 1}`;
        const basis = typeof s?.evidence_basis === 'string' ? s.evidence_basis : 'unknown';
        const citationCount = Array.isArray(s?.citations) ? s.citations.length : 0;
        const bodyPreview = typeof s?.body === 'string' ? redactMiddle(s.body, 140) : '';
        console.log(`[narration-smoke] section[${i}] title=${JSON.stringify(title)} evidence_basis=${basis} citations=${citationCount}`);
        if (bodyPreview) console.log(`  body: ${bodyPreview}`);
      }
    }
  }

  if (violations.length > 0) {
    console.log(`[narration-smoke] first_violations_count=${Math.min(10, violations.length)} of ${violations.length}`);
    for (const [i, v] of violations.slice(0, 10).entries()) {
      console.log(`[narration-smoke] violation[${i}] ${redactMiddle(JSON.stringify(v), 220)}`);
    }
  }
}

main().catch((e) => {
  console.error(`[narration-smoke] fatal: ${(e as any)?.message ?? String(e)}`);
  process.exit(1);
});
