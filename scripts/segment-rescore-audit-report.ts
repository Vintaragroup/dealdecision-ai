import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SegmentRescoreAuditItem = {
  page_label: string;
  segment: string;
  segment_source: string;
  persisted_segment_key?: string | null;
  captured_text?: string | null;
  computed_segment?: string | null;
  computed_reason?: {
    best_score?: number | null;
    keyword_hits?: Record<string, unknown>;
    unknown_reason_code?: string | null;
  } | null;
};

type SegmentAuditReport = {
  deal_id: string;
  generated_at: string;
  documents: Array<{
    document_id: string;
    title: string | null;
    type: string | null;
    items: SegmentRescoreAuditItem[];
  }>;
  error?: { code: string; message: string };
};

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "1";
    }
  }
  return out;
}

function escapeMdTableCell(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\|/g, "\\|")
    .trim();
}

async function atomicWriteFile(filePath: string, contents: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return json;
}

function formatKeywordHitsBrief(hits: Record<string, unknown> | undefined): string {
  if (!hits || typeof hits !== "object") return "—";
  const entries = Object.entries(hits)
    .filter(([k, v]) => typeof k === "string" && Array.isArray(v) && (v as unknown[]).length > 0)
    .slice(0, 3)
    .map(([k, v]) => {
      const arr = (v as unknown[]).filter((x) => typeof x === "string").slice(0, 5) as string[];
      return `${k}: ${arr.join(", ")}`;
    })
    .filter((s) => s.trim().length > 0);
  return entries.length ? escapeMdTableCell(entries.join(" | ")) : "(none)";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dealId = args["deal-id"] ?? process.env.DEAL_ID;
  if (!dealId) {
    throw new Error("Missing deal id. Provide --deal-id <uuid> or set DEAL_ID env var.");
  }

  const apiBaseUrl = (args["api-base-url"] ?? process.env.API_BASE_URL ?? "http://localhost:9000").replace(/\/$/, "");
  const url = `${apiBaseUrl}/api/v1/deals/${dealId}/lineage?debug_segments=1&segment_audit=1&segment_rescore=1`;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath = args["out"] ?? path.join(repoRoot, `docs/Reports/segment-rescore-audit.${dealId}.md`);

  const lineage = await fetchJson(url);
  const audit = lineage?.segment_audit_report as SegmentAuditReport | undefined;
  if (!audit || typeof audit !== "object") {
    throw new Error(`lineage response missing segment_audit_report (url=${url})`);
  }

  const lines: string[] = [];
  lines.push(`# Segment Rescore Audit Report`);
  lines.push("");
  lines.push(`Deal: **${audit.deal_id ?? dealId}**`);
  lines.push(`Generated: **${audit.generated_at ?? "UNKNOWN"}**`);
  lines.push("");

  if (audit.error) {
    lines.push(`> ERROR: ${audit.error.code} — ${audit.error.message}`);
    lines.push("");
  }

  const documents = Array.isArray(audit.documents) ? audit.documents : [];
  lines.push(`## Per-document breakdown`);
  lines.push("");

  for (const doc of documents) {
    const title = doc.title ?? "(untitled)";
    const docType = doc.type ?? "—";
    const items = Array.isArray(doc.items) ? doc.items : [];

    lines.push(`### ${escapeMdTableCell(title)}`);
    lines.push("");
    lines.push(`- Document ID: ${doc.document_id}`);
    lines.push(`- Document type: ${escapeMdTableCell(docType)}`);
    lines.push(`- Total items: ${items.length}`);
    lines.push("");

    lines.push(`| Page | Persisted | Computed | Captured text | Best score | Keyword hits | Notes/unknown_reason |`);
    lines.push(`|---|---|---|---|---:|---|---|`);

    for (const it of items) {
      const persisted = it.persisted_segment_key ?? it.segment ?? "unknown";
      const computed = it.computed_segment ?? "—";
      const captured = typeof it.captured_text === "string" ? it.captured_text : "";
      const best = typeof it.computed_reason?.best_score === "number" ? it.computed_reason.best_score.toFixed(2) : "—";
      const hits = formatKeywordHitsBrief(it.computed_reason?.keyword_hits as any);
      const unknownCode = it.computed_segment === "unknown" ? (it.computed_reason?.unknown_reason_code ?? "—") : "";
      const notes = unknownCode ? `unknown_reason=${unknownCode}` : "";

      lines.push(
        `| ${escapeMdTableCell(it.page_label ?? "—")} | ${escapeMdTableCell(String(persisted))} | ${escapeMdTableCell(String(computed))} | ${escapeMdTableCell(captured)} | ${best} | ${hits} | ${escapeMdTableCell(notes)} |`
      );
    }

    lines.push("");
  }

  lines.push("---");
  lines.push("Discovery-only: computed fields are derived at request time; no DB writes.");

  await atomicWriteFile(outPath, lines.join("\n"));
  console.log(`[segment-rescore-audit-report] Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
