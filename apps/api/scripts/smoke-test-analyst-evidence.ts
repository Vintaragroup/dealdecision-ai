import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { closePool, getPool } from '../src/lib/db';

type SmokeConfig = {
  apiBaseUrl: string;
  dealId?: string;
  uploadDir: string;
  authHeader?: { name: string; value: string };
};

function hasPlaceholder(value: string): boolean {
  const v = String(value);
  return v.includes('<') || v.includes('>') || v.toLowerCase().includes('<api_port>');
}

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

function parseHeaderLine(line: string | undefined): { name: string; value: string } | undefined {
  if (!line) return undefined;
  const idx = line.indexOf(':');
  if (idx <= 0) return undefined;
  const name = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (!name || !value) return undefined;
  return { name, value };
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

function redactMiddle(value: string, maxLen: number = 120): string {
  const s = String(value);
  if (s.length <= maxLen) return s;
  const head = s.slice(0, Math.max(20, Math.floor(maxLen * 0.6)));
  const tail = s.slice(-Math.max(10, Math.floor(maxLen * 0.2)));
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

async function fetchHead(url: string, opts: { headers?: Record<string, string> } = {}) {
  const res = await fetch(url, { method: 'HEAD', headers: opts.headers });
  return { status: res.status, ok: res.ok };
}

async function discoverMostRecentDealAndDoc(): Promise<{ dealId: string; documentId: string } | null> {
  const pool = getPool();

  // Pick the most recent deal having at least one visual asset.
  const dealRes = await pool.query<{ deal_id: string }>(
    `SELECT d.id AS deal_id
       FROM deals d
       JOIN documents doc ON doc.deal_id = d.id
       JOIN visual_assets va ON va.document_id = doc.id
      ORDER BY va.created_at DESC
      LIMIT 1`
  );
  if (!dealRes.rows.length) return null;
  const dealId = dealRes.rows[0].deal_id;

  const docRes = await pool.query<{ document_id: string }>(
    `SELECT doc.id AS document_id
       FROM documents doc
       JOIN visual_assets va ON va.document_id = doc.id
      WHERE doc.deal_id = $1
      ORDER BY va.created_at DESC
      LIMIT 1`,
    [dealId]
  );
  if (!docRes.rows.length) return null;

  return { dealId, documentId: docRes.rows[0].document_id };
}

type ImageUriCheckResult =
  | { kind: 'OK'; detail: string }
  | { kind: 'MISSING'; detail: string }
  | { kind: 'URL_UNVERIFIED'; detail: string }
  | { kind: 'UNKNOWN'; detail: string };

function resolveUploadsPath(uploadDir: string, uri: string): string | null {
  // Map /uploads/... -> UPLOAD_DIR/...
  if (uri.startsWith('/uploads/')) {
    const rel = uri.replace(/^\/uploads\//, '');
    return path.resolve(uploadDir, rel);
  }

  // Best-effort mapping for /app/uploads/... when running outside Docker.
  if (uri.startsWith('/app/uploads/')) {
    const rel = uri.replace(/^\/app\/uploads\//, '');
    return path.resolve(uploadDir, rel);
  }

  return null;
}

async function validateImageUri(
  imageUri: string | null,
  cfg: SmokeConfig
): Promise<{ result: ImageUriCheckResult; missingIsError: boolean }> {
  if (!imageUri || imageUri.trim().length === 0) {
    return { result: { kind: 'MISSING', detail: 'image_uri is null/empty' }, missingIsError: false };
  }

  const uri = imageUri.trim();

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    // Optional verification: if auth is required and not provided, skip with note.
    const headers: Record<string, string> = {};
    if (cfg.authHeader) headers[cfg.authHeader.name] = cfg.authHeader.value;

    try {
      const head = await fetchHead(uri, { headers });
      if (head.ok) return { result: { kind: 'OK', detail: `HEAD ${head.status}` }, missingIsError: false };

      if (head.status === 401 || head.status === 403) {
        if (!cfg.authHeader) {
          return {
            result: { kind: 'URL_UNVERIFIED', detail: `HEAD ${head.status} (auth required; skipping)` },
            missingIsError: false,
          };
        }
      }

      return { result: { kind: 'URL_UNVERIFIED', detail: `HEAD ${head.status}` }, missingIsError: false };
    } catch (e) {
      return { result: { kind: 'URL_UNVERIFIED', detail: `HEAD failed: ${(e as any)?.message ?? String(e)}` }, missingIsError: false };
    }
  }

  if (uri.startsWith('/')) {
    // Local-path style.
    if (uri.startsWith('/app/uploads') || uri.startsWith('/uploads/')) {
      const directExists = fs.existsSync(uri);
      if (directExists) {
        return { result: { kind: 'OK', detail: `exists: ${uri}` }, missingIsError: false };
      }

      const mapped = resolveUploadsPath(cfg.uploadDir, uri);
      if (mapped && fs.existsSync(mapped)) {
        return { result: { kind: 'OK', detail: `exists (mapped): ${mapped}` }, missingIsError: false };
      }

      return {
        result: { kind: 'MISSING', detail: `missing file for image_uri: ${uri}${mapped ? ` (mapped: ${mapped})` : ''}` },
        missingIsError: true,
      };
    }

    return { result: { kind: 'UNKNOWN', detail: `unrecognized absolute path: ${uri}` }, missingIsError: false };
  }

  return { result: { kind: 'UNKNOWN', detail: `unrecognized image_uri format: ${uri}` }, missingIsError: false };
}

function buildConfig(): SmokeConfig {
  const args = parseArgs(process.argv.slice(2));

  const apiBaseUrl = args['api-base-url'] || process.env.API_BASE_URL || 'http://localhost:9000';

  const dealId = args['deal-id'] || process.env.DEAL_ID || undefined;

  const uploadDir = args['upload-dir'] || process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');

  const authHeaderLine =
    args['auth-header'] ||
    process.env.API_AUTH_HEADER ||
    process.env.AUTH_HEADER ||
    undefined;

  const authHeader = parseHeaderLine(authHeaderLine);

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    dealId,
    uploadDir,
    authHeader,
  };
}

async function main() {
  loadEnv();
  const cfg = buildConfig();

  if (hasPlaceholder(cfg.apiBaseUrl)) {
    console.error('FAIL: invalid --api-base-url');
    console.error('Do not use placeholders like <api_port>. Your API port is 9000. Use: --api-base-url http://localhost:9000');
    process.exit(4);
    return;
  }

  const headers: Record<string, string> = {};
  if (cfg.authHeader) headers[cfg.authHeader.name] = cfg.authHeader.value;

  let dealId = cfg.dealId;
  let documentId: string | undefined;

  const printHowToFixNoVisualAssets = () => {
    console.error('How to fix:');
    console.error('- Ensure ENABLE_VISUAL_EXTRACTION=1 in the environment');
    console.error('- Ingest a PDF/deck');
    console.error('- Wait for the extract_visuals job to finish (check worker logs)');
    console.error('- Run: pnpm smoke:analyst-evidence --api-base-url http://localhost:9000');
    console.error('- If the worker is skipping writes: verify migrations ran and visual extraction tables exist (visual_assets, visual_extractions, evidence_links)');
  };

  if (!dealId) {
    const found = await discoverMostRecentDealAndDoc();
    if (!found) {
      console.error('FAIL: no deal found with visual_assets');
      printHowToFixNoVisualAssets();
      process.exit(2);
      return;
    }
    dealId = found.dealId;
    documentId = found.documentId;
  }

  // If dealId was provided, still need a document_id with visual assets.
  if (dealId && !documentId) {
    const pool = getPool();
    const docRes = await pool.query<{ document_id: string }>(
      `SELECT doc.id AS document_id
         FROM documents doc
         JOIN visual_assets va ON va.document_id = doc.id
        WHERE doc.deal_id = $1
        ORDER BY va.created_at DESC
        LIMIT 1`,
      [dealId]
    );

    if (!docRes.rows.length) {
      console.error(`FAIL: deal has no documents with visual_assets: deal_id=${dealId}`);
      printHowToFixNoVisualAssets();
      process.exit(3);
      return;
    }
    documentId = docRes.rows[0].document_id;
  }

  if (!dealId || !documentId) {
    console.error('FAIL: missing deal_id or document_id after discovery');
    process.exit(5);
    return;
  }

  // 1) Lineage API
  const lineageUrl = `${cfg.apiBaseUrl}/api/v1/deals/${dealId}/lineage`;
  const lineage = await fetchJson(lineageUrl, { headers });
  if (!lineage.ok) {
    console.error(`FAIL: lineage endpoint returned ${lineage.status}`);
    console.error(redactMiddle(lineage.text, 400));
    process.exit(10);
    return;
  }

  const nodeCount = Array.isArray(lineage.json?.nodes) ? lineage.json.nodes.length : 0;
  const edgeCount = Array.isArray(lineage.json?.edges) ? lineage.json.edges.length : 0;
  if (nodeCount <= 0) {
    console.error('FAIL: lineage returned 0 nodes');
    process.exit(11);
    return;
  }

  // 2) Visual assets API
  const assetsUrl = `${cfg.apiBaseUrl}/api/v1/deals/${dealId}/documents/${documentId}/visual-assets`;
  const assetsRes = await fetchJson(assetsUrl, { headers });
  if (!assetsRes.ok) {
    console.error(`FAIL: visual-assets endpoint returned ${assetsRes.status}`);
    console.error(redactMiddle(assetsRes.text, 400));
    process.exit(20);
    return;
  }

  const assets = Array.isArray(assetsRes.json?.assets) ? assetsRes.json.assets : [];
  if (assets.length <= 0) {
    console.error('FAIL: visual-assets returned 0 assets');
    process.exit(21);
    return;
  }

  const sample = assets.find((a: any) => typeof a?.image_uri === 'string' && a.image_uri.trim().length > 0) || assets[0];

  const sampleImageUri = typeof sample?.image_uri === 'string' ? sample.image_uri : null;
  const sampleAssetType = typeof sample?.asset_type === 'string' ? sample.asset_type : '—';
  const samplePageIndex = typeof sample?.page_index === 'number' ? sample.page_index : null;
  const sampleExtractorVersion = typeof sample?.extractor_version === 'string' ? sample.extractor_version : '—';
  const sampleConfidence = typeof sample?.confidence === 'number' ? sample.confidence : null;

  const latest = sample?.latest_extraction;
  const hasOcr = typeof latest?.ocr_text === 'string' && latest.ocr_text.trim().length > 0;
  const hasStructuredJson = latest?.structured_json != null && Object.keys(latest.structured_json || {}).length > 0;

  const imgCheck = await validateImageUri(sampleImageUri, cfg);

  // Output report (concise)
  console.log('Analyst Evidence Smoke Test');
  console.log(`- deal_id: ${dealId}`);
  console.log(`- document_id: ${documentId}`);
  console.log(`- lineage: nodes=${nodeCount} edges=${edgeCount}`);
  console.log(`- visual_assets: count=${assets.length}`);
  console.log(
    `- sample_asset: type=${sampleAssetType} page=${samplePageIndex != null ? samplePageIndex + 1 : '—'} conf=${sampleConfidence != null ? sampleConfidence.toFixed(2) : '—'} version=${sampleExtractorVersion}`
  );
  console.log(
    `- sample_asset_data: image_uri=${sampleImageUri ? redactMiddle(sampleImageUri) : '—'} has_ocr=${hasOcr ? 'yes' : 'no'} has_structured_json=${hasStructuredJson ? 'yes' : 'no'}`
  );
  console.log(`- image_uri_check: ${imgCheck.result.kind} (${imgCheck.result.detail})`);

  if (imgCheck.missingIsError) {
    process.exit(30);
    return;
  }

  process.exit(0);
}

main()
  .catch((err) => {
    console.error('FAIL: smoke test threw');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
