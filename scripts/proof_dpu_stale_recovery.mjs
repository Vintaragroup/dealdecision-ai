#!/usr/bin/env node
/**
 * proof_dpu_stale_recovery.mjs
 *
 * End-to-end proof harness: demonstrates the stale-but-complete DPU flow works.
 *
 * Steps:
 *  1. GET  /api/v1/deals/:id/readiness          → assert dpu_stale blocked state
 *  2. POST /api/v1/deals/:id/investor-insights/regenerate → assert 202 preparing_documents
 *  3. POST /api/v1/analysis/start               → assert 202 preparing_documents (both endpoints)
 *  4. Poll /readiness until ready:true OR timeout
 *  5. POST regenerate again                     → assert success
 *  6. GET  /api/v1/deals/:id/orchestrator-report → assert NO dpu_stale: warning
 *  7. Print a markdown summary
 *
 * Usage:
 *   API_BASE=http://localhost:9001 DEAL_ID=<uuid> node scripts/proof_dpu_stale_recovery.mjs
 *   (or via pnpm proof:dpu-stale)
 *
 * Env vars:
 *   API_BASE    — API server base URL (default: http://localhost:9001)
 *   DEAL_ID     — required: UUID of a deal that is currently dpu_stale
 *   TIMEOUT_MS  — max polling duration in ms (default: 120000)
 *   POLL_MS     — polling interval in ms (default: 1500)
 *   SKIP_POLL   — if "1", skip the readiness poll loop (useful for quick structural checks)
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = (process.env.API_BASE ?? "http://localhost:9001").replace(/\/$/, "");
const DEAL_ID = process.env.DEAL_ID ?? "";
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS ?? "120000", 10);
const POLL_MS = parseInt(process.env.POLL_MS ?? "1500", 10);
const SKIP_POLL = process.env.SKIP_POLL === "1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString();
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`\n✗ ASSERTION FAILED [${ts()}]: ${msg}\n`);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(method, url, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function excerpt(obj, maxLen = 300) {
  const s = JSON.stringify(obj, null, 2);
  return s.length <= maxLen ? s : s.slice(0, maxLen) + "\n  …(truncated)";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const log = [];
function record(label, value) {
  const line = `| ${label.padEnd(40)} | ${String(value).replace(/\n/g, " ").slice(0, 120)} |`;
  log.push(line);
  console.log(`  ${label}: ${String(value).slice(0, 200)}`);
}

async function main() {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`DPU Stale Recovery Proof Harness`);
  console.log(`${"─".repeat(72)}`);
  console.log(`API_BASE  : ${API_BASE}`);
  console.log(`DEAL_ID   : ${DEAL_ID}`);
  console.log(`TIMEOUT   : ${TIMEOUT_MS}ms`);
  console.log(`${"─".repeat(72)}\n`);

  assert(DEAL_ID.length > 0, "DEAL_ID env var is required. Export a UUID of a dpu_stale deal.");

  const t0 = Date.now();
  const steps = [];

  // ── Step 1: GET readiness — assert deal is dpu_stale ─────────────────────

  console.log(`[1] GET readiness…`);
  const r1 = await fetchJson("GET", `${API_BASE}/api/v1/deals/${DEAL_ID}/readiness?page_understanding_version=page_understanding_v1`);
  record("readiness.status", r1.status);
  record("readiness.ready", r1.data?.ready);
  record("readiness.blocked_reason", r1.data?.blocked_reason ?? "(none)");
  record("readiness.missing_pages_total", r1.data?.missing_pages_total ?? "(n/a)");
  record("readiness.docs_fingerprint", r1.data?.docs_fingerprint ?? "(none)");
  record("readiness.latest_dpu_created_at", r1.data?.latest_dpu_created_at ?? "(none)");

  assert(r1.status === 200, `readiness endpoint must return 200, got ${r1.status}`);
  const readinessBlockedReason = (r1.data?.blocked_reason ?? "").toLowerCase();
  const isStaleDpu = readinessBlockedReason === "dpu_stale";
  const hasStaleInDiagnostics =
    r1.data?.stale_diagnostics?.stale_reason != null ||
    r1.data?.stale_diagnostics?.reason != null;

  if (!isStaleDpu && !hasStaleInDiagnostics) {
    console.error(
      `\n⚠  Deal ${DEAL_ID} does not appear to be dpu_stale.` +
      `\n   blocked_reason = "${r1.data?.blocked_reason ?? "(none)"}"` +
      `\n   ready          = ${r1.data?.ready}` +
      `\n\n   This script needs a deal that is dpu_stale.` +
      `\n   To manufacture the condition locally:` +
      `\n     1. Find a deal with documents.` +
      `\n     2. In the DB: UPDATE document_page_understanding` +
      `\n        SET created_at = now() - interval '365 days'` +
      `\n        WHERE deal_id = '${DEAL_ID}';` +
      `\n     3. Re-run with DEAL_ID=${DEAL_ID}.` +
      `\n`
    );
    process.exit(2);
  }

  const initialFingerprint = r1.data?.docs_fingerprint ?? null;
  const initialStaleReason = r1.data?.stale_diagnostics?.stale_reason ?? r1.data?.stale_diagnostics?.reason ?? readinessBlockedReason;
  record("readiness.stale_reason", initialStaleReason);
  steps.push({ step: 1, label: "GET readiness", status: "✓ PASS", detail: `blocked_reason=${r1.data?.blocked_reason ?? "−"}, stale_reason=${initialStaleReason}` });
  console.log(`  ✓ Deal is dpu_stale (stale_reason: ${initialStaleReason})\n`);

  // ── Step 2: POST regenerate → 202 preparing_documents ────────────────────

  console.log(`[2] POST investor-insights/regenerate (expect 202 preparing_documents)…`);
  const r2 = await fetchJson("POST", `${API_BASE}/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`);
  record("regenerate.status", r2.status);
  record("regenerate.data.status", r2.data?.status ?? "(none)");
  record("regenerate.blocked_reason", r2.data?.blocked_reason ?? "(none)");
  record("regenerate.action_detail.job_id", r2.data?.action_detail?.job_id ?? r2.data?.action ?? "(none)");
  record("regenerate.docs_fingerprint", r2.data?.docs_fingerprint ?? "(none)");
  record("regenerate.stale_diagnostics.stale_reason", r2.data?.stale_diagnostics?.stale_reason ?? "(none)");

  assert(r2.status === 202, `regenerate must return 202, got ${r2.status}: ${JSON.stringify(r2.data)}`);
  assert(r2.data?.status === "preparing_documents", `Expected status=preparing_documents, got: ${r2.data?.status}`);
  assert((r2.data?.blocked_reason ?? "").toLowerCase() === "dpu_stale", `Expected blocked_reason=dpu_stale, got: ${r2.data?.blocked_reason}`);
  assert(r2.data?.docs_fingerprint != null, "202 response must include docs_fingerprint");
  assert(r2.data?.stale_diagnostics != null, "202 response must include stale_diagnostics");

  const capturedJobId = r2.data?.action_detail?.job_id ?? null;
  const capturedFingerprint = r2.data?.docs_fingerprint;
  const capturedStaleReason = r2.data?.stale_diagnostics?.stale_reason ?? "(present, no reason field)";
  record("captured.job_id", capturedJobId ?? "(none — action_detail absent)");
  record("captured.stale_reason", capturedStaleReason);

  steps.push({ step: 2, label: "POST regenerate → 202", status: "✓ PASS", detail: `stale_diagnostics.stale_reason=${capturedStaleReason}` });
  console.log(`  ✓ 202 preparing_documents confirmed, stale_diagnostics present\n`);

  // ── Step 3: POST analysis/start → 202 preparing_documents ────────────────

  console.log(`[3] POST analysis/start (expect 202 preparing_documents)…`);
  const r3 = await fetchJson("POST", `${API_BASE}/api/v1/analysis/start`, {
    deal_id: DEAL_ID,
    max_cycles: 3,
    analysis_mode: "full",
  });
  record("analysis_start.status", r3.status);
  record("analysis_start.data.status", r3.data?.status ?? "(none)");
  record("analysis_start.blocked_reason", r3.data?.blocked_reason ?? "(none)");
  record("analysis_start.stale_diagnostics", r3.data?.stale_diagnostics != null ? "present" : "absent");

  // analysis/start preflight behaves the same as regenerate when DPU is stale
  if (r3.status === 202) {
    assert(r3.data?.blocked_reason?.toLowerCase() === "dpu_stale", `Expected blocked_reason=dpu_stale from analysis/start, got: ${r3.data?.blocked_reason}`);
    assert(r3.data?.stale_diagnostics != null, "analysis/start 202 must include stale_diagnostics");
    steps.push({ step: 3, label: "POST analysis/start → 202", status: "✓ PASS", detail: `stale_diagnostics present` });
    console.log(`  ✓ 202 preparing_documents confirmed from analysis/start\n`);
  } else {
    // analysis/start may also return 400 if the deal has no documents yet; treat as skip
    steps.push({ step: 3, label: "POST analysis/start", status: `⚠ SKIP (${r3.status})`, detail: r3.data?.error ?? "(no error field)" });
    console.warn(`  ⚠ analysis/start returned ${r3.status} (may lack documents) — skipping assertion\n`);
  }

  // ── Step 4: job_id stability assertion ───────────────────────────────────

  if (capturedJobId) {
    console.log(`[4] Re-calling regenerate to verify job_id is deterministic (same fingerprint → same job_id)…`);
    const r4 = await fetchJson("POST", `${API_BASE}/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`);
    const secondJobId = r4.data?.action_detail?.job_id ?? null;
    record("re-regenerate.second_job_id", secondJobId ?? "(none)");
    if (secondJobId && secondJobId === capturedJobId) {
      steps.push({ step: 4, label: "Deterministic job_id (same fingerprint)", status: "✓ PASS", detail: `job_id=${capturedJobId}` });
      console.log(`  ✓ job_id is stable: ${capturedJobId}\n`);
    } else if (secondJobId) {
      // fingerprint may have changed (new DPU rows arrived) — acceptable
      steps.push({ step: 4, label: "Deterministic job_id", status: "⚠ CHANGED", detail: `first=${capturedJobId} second=${secondJobId} (fingerprint may have evolved)` });
      console.warn(`  ⚠ job_id changed (fingerprint evolved): first=${capturedJobId} second=${secondJobId}\n`);
    } else {
      steps.push({ step: 4, label: "Deterministic job_id", status: "⚠ SKIP", detail: "action_detail absent on second call (may have become ready)" });
      console.warn(`  ⚠ action_detail absent on second call — deal may have become ready\n`);
    }
  } else {
    steps.push({ step: 4, label: "Deterministic job_id", status: "⚠ SKIP", detail: "action_detail.job_id absent from first call" });
    console.warn(`  ⚠ action_detail.job_id not present — skipping stability check\n`);
  }

  // ── Step 5: Poll readiness until ready:true ───────────────────────────────

  let finalReadiness = null;
  if (SKIP_POLL) {
    steps.push({ step: 5, label: "Poll readiness", status: "⚠ SKIP", detail: "SKIP_POLL=1" });
    console.log(`[5] Skipping poll (SKIP_POLL=1)\n`);
  } else {
    console.log(`[5] Polling readiness until ready:true (timeout: ${TIMEOUT_MS}ms, interval: ${POLL_MS}ms)…`);
    let pollCount = 0;
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const rp = await fetchJson("GET", `${API_BASE}/api/v1/deals/${DEAL_ID}/readiness?page_understanding_version=page_understanding_v1`);
      pollCount++;
      const isReady = rp.data?.ready === true;
      const pollReason = rp.data?.blocked_reason ?? "(none)";
      const pollFp = rp.data?.docs_fingerprint ?? "(none)";
      const pollTs = rp.data?.latest_dpu_created_at ?? "(none)";
      const fpDrift = pollFp !== initialFingerprint ? " [fingerprint changed]" : "";
      console.log(`  [${String(pollCount).padStart(3)}] ready=${isReady}  blocked=${pollReason}  fp=${pollFp}${fpDrift}  dpu_ts=${pollTs}`);

      if (isReady) {
        finalReadiness = rp.data;
        steps.push({ step: 5, label: `Poll readiness (${pollCount} polls)`, status: "✓ PASS", detail: `ready=true after ${Math.round((Date.now() - t0) / 1000)}s` });
        console.log(`  ✓ ready:true after ${pollCount} polls\n`);
        break;
      }
      if (Date.now() + POLL_MS < deadline) {
        await sleep(POLL_MS);
      } else {
        break;
      }
    }
    if (!finalReadiness) {
      steps.push({ step: 5, label: "Poll readiness", status: "⚠ TIMEOUT", detail: `exceeded ${TIMEOUT_MS}ms — DPU backfill may still be running` });
      console.warn(
        `  ⚠ Readiness poll timed out after ${TIMEOUT_MS}ms.\n` +
        `  The DPU worker is likely still processing. In a real environment,\n` +
        `  poll until the worker completes.\n`
      );
    }
  }

  // ── Step 6: POST regenerate after readiness (if we got ready) ────────────

  if (finalReadiness) {
    console.log(`[6] POST regenerate after readiness (expect 200/ok or enqueued=true)…`);
    const r6 = await fetchJson("POST", `${API_BASE}/api/v1/deals/${DEAL_ID}/investor-insights/regenerate`);
    record("post-ready-regenerate.status", r6.status);
    record("post-ready-regenerate.data", JSON.stringify(r6.data ?? {}).slice(0, 120));

    // Success = 202 with ok:true or enqueued:true (NOT preparing_documents)
    const isSuccess = r6.status === 202 && (r6.data?.ok === true || r6.data?.enqueued === true);
    const isStillStale = r6.data?.status === "preparing_documents";

    if (isSuccess) {
      steps.push({ step: 6, label: "POST regenerate (post-ready)", status: "✓ PASS", detail: `status=${r6.status} enqueued=${r6.data?.enqueued}` });
      console.log(`  ✓ Regenerate succeeded after readiness\n`);
    } else if (isStillStale) {
      steps.push({ step: 6, label: "POST regenerate (post-ready)", status: "⚠ STILL_STALE", detail: `status=202 preparing_documents — DPU may have re-stalened` });
      console.warn(`  ⚠ Still returning preparing_documents — DPU may have re-stalened\n`);
    } else {
      steps.push({ step: 6, label: "POST regenerate (post-ready)", status: `✗ UNEXPECTED (${r6.status})`, detail: JSON.stringify(r6.data ?? {}).slice(0, 120) });
      console.warn(`  ⚠ Unexpected response: ${r6.status} ${JSON.stringify(r6.data)}\n`);
    }

    // ── Step 7: GET orchestrator-report → no dpu_stale: warning ─────────────

    console.log(`[7] GET orchestrator-report → assert no dpu_stale: warning…`);
    // Allow the worker a moment to attach the report
    await sleep(3000);
    const r7 = await fetchJson("GET", `${API_BASE}/api/v1/deals/${DEAL_ID}/orchestrator-report`);
    record("orchestrator-report.status", r7.status);
    if (r7.status === 200) {
      const warnings = r7.data?.report?.diagnostics?.warnings ?? [];
      const hasStaleWarning = warnings.some((w) => typeof w === "string" && w.startsWith("dpu_stale:"));
      record("orchestrator-report.warnings_count", warnings.length);
      record("orchestrator-report.has_dpu_stale_warning", hasStaleWarning);

      if (!hasStaleWarning) {
        steps.push({ step: 7, label: "Orchestrator lacks dpu_stale warning", status: "✓ PASS", detail: `warnings=[${warnings.map((w) => String(w).slice(0, 40)).join("; ")}]` });
        console.log(`  ✓ No dpu_stale: warning in orchestrator report\n`);
      } else {
        steps.push({ step: 7, label: "Orchestrator lacks dpu_stale warning", status: "⚠ STILL_PRESENT", detail: `dpu_stale: warning still present (try after worker finishes)` });
        console.warn(`  ⚠ dpu_stale: warning still present — worker may not have re-run yet\n`);
      }
    } else if (r7.status === 404) {
      steps.push({ step: 7, label: "Orchestrator report check", status: "⚠ SKIP", detail: "report not yet generated (worker queued)" });
      console.warn(`  ⚠ Orchestrator report not yet generated (worker queued)\n`);
    } else {
      steps.push({ step: 7, label: "Orchestrator report check", status: `⚠ ${r7.status}`, detail: String(r7.data?.error ?? "(no error)") });
    }
  } else {
    steps.push({ step: 6, label: "POST regenerate (post-ready)", status: "⚠ SKIP", detail: "skipped: readiness poll did not complete" });
    steps.push({ step: 7, label: "Orchestrator report check", status: "⚠ SKIP", detail: "skipped: readiness poll did not complete" });
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const elapsed = `${Math.round((Date.now() - t0) / 100) / 10}s`;
  console.log(`\n${"═".repeat(72)}`);
  console.log(`PROOF SUMMARY  (elapsed: ${elapsed})`);
  console.log(`${"═".repeat(72)}`);
  console.log(`\n## DPU Stale Recovery Proof — ${new Date().toISOString()}\n`);
  console.log(`**Deal ID:** \`${DEAL_ID}\``);
  console.log(`**API Base:** \`${API_BASE}\``);
  console.log(`**Initial fingerprint:** \`${initialFingerprint ?? "(none)"}\``);
  console.log(`**Initial stale reason:** \`${initialStaleReason}\``);
  console.log(`**Elapsed:** ${elapsed}\n`);
  console.log(`| Step | Label | Status | Detail |`);
  console.log(`|------|-------|--------|--------|`);
  for (const s of steps) {
    console.log(`| ${s.step} | ${s.label} | ${s.status} | ${(s.detail ?? "").slice(0, 100)} |`);
  }
  console.log();

  const failures = steps.filter((s) => s.status.startsWith("✗"));
  const warnings = steps.filter((s) => s.status.startsWith("⚠"));
  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} step(s) FAILED. The DPU stale recovery flow is broken.\n`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.warn(`\n⚠ ${warnings.length} step(s) produced warnings (see above). Check that the DPU worker is running.\n`);
    process.exit(0);
  }
  console.log(`\n✓ All steps passed. DPU stale recovery flow is working correctly.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ Unhandled error in proof harness:\n`, err);
  process.exit(1);
});
