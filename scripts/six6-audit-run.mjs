#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API_BASE_URL || 'http://localhost:9001';
const ROOT = process.cwd();
const TS = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const DEALS = [
  {
    key: 'pai',
    name: 'Six6 Audit - PAI',
    file: 'docs/reference-deal-docs/PDF-pptx-deals/Six6-Audit/PAI/PAI - Investor Deck _Investment Banker_March 2026.pdf',
    type: 'pitch_deck',
    mime: 'application/pdf',
  },
  {
    key: 'climatic',
    name: 'Six6 Audit - Climatic',
    file: 'docs/reference-deal-docs/PDF-pptx-deals/Six6-Audit/Climatic/Climatic PitchDeck (5).pdf',
    type: 'pitch_deck',
    mime: 'application/pdf',
  },
  {
    key: 'weavstra',
    name: 'Six6 Audit - Weavstra',
    file: 'docs/reference-deal-docs/PDF-pptx-deals/Six6-Audit/Weavstra/Weavstra.pdf',
    type: 'pitch_deck',
    mime: 'application/pdf',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function createOrGetDeal(name) {
  const resp = await fetchJson(`${API}/api/v1/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, stage: 'intake', priority: 'medium' }),
  });
  if (resp.ok && resp.data?.id) return resp.data.id;
  if (resp.status === 409 && resp.data?.existing_deal_id) return resp.data.existing_deal_id;
  throw new Error(`createOrGetDeal failed ${resp.status}: ${JSON.stringify(resp.data).slice(0, 400)}`);
}

async function uploadDocument(dealId, cfg) {
  const abs = path.join(ROOT, cfg.file);
  const bytes = fs.readFileSync(abs);
  const form = new FormData();
  form.set('type', cfg.type);
  form.set('title', path.basename(abs));
  form.set('duplicate_policy', 'replace');
  form.set('file', new Blob([bytes], { type: cfg.mime }), path.basename(abs));

  const resp = await fetchJson(`${API}/api/v1/deals/${dealId}/documents`, { method: 'POST', body: form });
  if (!(resp.ok || resp.status === 202)) {
    throw new Error(`uploadDocument failed ${resp.status}: ${JSON.stringify(resp.data).slice(0, 400)}`);
  }
  return {
    document_id: resp.data?.document?.document_id || resp.data?.document?.id || resp.data?.document_id || null,
    job_id: resp.data?.job_id || null,
    response: resp.data,
  };
}

async function waitJob(jobId, timeoutMs = 40 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const j = await fetchJson(`${API}/api/v1/jobs/${jobId}`);
    if (j.ok) {
      const s = String(j.data?.status || '').toLowerCase();
      if (['succeeded', 'completed', 'failed', 'error', 'cancelled'].includes(s)) return j.data;
    }
    await sleep(4000);
  }
  return { job_id: jobId, status: 'timeout' };
}

async function triggerAnalyze(dealId) {
  let minDpu = null;
  for (let i = 0; i < 50; i += 1) {
    const body = {
      require_page_understanding: true,
      force_refresh: true,
      ...(minDpu ? { min_dpu_created_at: minDpu } : {}),
    };
    const resp = await fetchJson(`${API}/api/v1/deals/${dealId}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (resp.data?.job_id) {
      return { analyze_request: resp.data, analyze_job: await waitJob(resp.data.job_id) };
    }

    if (String(resp.data?.status || '') === 'preparing_documents') {
      if (resp.data?.min_dpu_created_at) minDpu = resp.data.min_dpu_created_at;
      const readiness = await fetchJson(`${API}/api/v1/deals/${dealId}/readiness${minDpu ? `?min_dpu_created_at=${encodeURIComponent(minDpu)}` : ''}`);
      if (readiness.data?.ready === true) continue;
      await sleep(Number(resp.data?.poll_after_ms || 2500));
      continue;
    }

    await sleep(3000);
  }

  return { analyze_request: { status: 'timeout_preparing' } };
}

async function waitReport(dealId, timeoutMs = 40 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = await fetchJson(`${API}/api/v1/deals/${dealId}/report`);
    if (r.ok) {
      if (r.data?.ready === true || Array.isArray(r.data?.sections)) return r.data;
    }
    await sleep(5000);
  }
  return (await fetchJson(`${API}/api/v1/deals/${dealId}/report`)).data;
}

async function fetchBundle(dealId, documentId) {
  const [documents, report, diagnostics, docAnalysis, docVisualAssets] = await Promise.all([
    fetchJson(`${API}/api/v1/deals/${dealId}/documents`),
    fetchJson(`${API}/api/v1/deals/${dealId}/report`),
    fetchJson(`${API}/api/v1/deals/${dealId}/report_diagnostics`),
    documentId ? fetchJson(`${API}/api/v1/deals/${dealId}/documents/${documentId}/analysis`) : Promise.resolve({ data: null }),
    documentId ? fetchJson(`${API}/api/v1/deals/${dealId}/documents/${documentId}/visual-assets?include_ocr=true`) : Promise.resolve({ data: null }),
  ]);

  return {
    documents: documents.data,
    report: report.data,
    report_diagnostics: diagnostics.data,
    document_analysis: docAnalysis.data,
    document_visual_assets: docVisualAssets.data,
  };
}

async function main() {
  const outManifest = {
    generated_at: new Date().toISOString(),
    api_base_url: API,
    run_id: TS,
    deals: [],
  };

  for (const cfg of DEALS) {
    const row = {
      key: cfg.key,
      name: cfg.name,
      source_file: cfg.file,
      started_at: new Date().toISOString(),
    };

    log(`START ${cfg.name}`);
    row.deal_id = await createOrGetDeal(cfg.name);
    log(`deal_id=${row.deal_id}`);

    row.upload = await uploadDocument(row.deal_id, cfg);
    log(`upload document_id=${row.upload.document_id} job_id=${row.upload.job_id || 'none'}`);

    if (row.upload.job_id) {
      row.ingest_job = await waitJob(row.upload.job_id);
      log(`ingest status=${row.ingest_job?.status}`);
    }

    row.analysis = await triggerAnalyze(row.deal_id);
    log(`analysis status=${row.analysis?.analyze_job?.status || row.analysis?.analyze_request?.status}`);

    row.final_report = await waitReport(row.deal_id);
    log(`report compiler=${row.final_report?.__compiler_version} ready=${row.final_report?.ready}`);

    row.bundle = await fetchBundle(row.deal_id, row.upload.document_id);

    row.finished_at = new Date().toISOString();
    const rawPath = `artifacts/six6_${cfg.key}_raw_${TS}.json`;
    fs.writeFileSync(path.join(ROOT, rawPath), JSON.stringify(row, null, 2));
    row.raw_artifact = rawPath;

    outManifest.deals.push(row);
  }

  const manifestPath = path.join(ROOT, `artifacts/six6_audit_manifest_${TS}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(outManifest, null, 2));
  log(`DONE manifest=${path.relative(ROOT, manifestPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
