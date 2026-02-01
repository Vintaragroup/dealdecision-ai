export {};

import fs from "node:fs";
import path from "node:path";

type SegmentAuditItem = {
  segment?: string;
  segment_source?: string;
  segment_confidence?: number | null;
  page_label?: string | null;
  page_index?: number | null;
  snippet?: string | null;
  reason?: {
    unknown_reason_code?: string | null;
  };
  computed_reason?: {
    unknown_reason_code?: string | null;
    rule_id?: string | null;
  };
};

type SegmentAuditDocument = {
  document_id: string;
  title: string | null;
  type: string | null;
  page_count: number | null;
  items: SegmentAuditItem[];
};

type SegmentAuditReport = {
  deal_id: string;
  generated_at: string;
  documents: SegmentAuditDocument[];
};

type LineageArtifact = {
  deal_id: string;
  segment_audit_report?: SegmentAuditReport;
};

type DealRow = {
  deal_id: string;
  deal: string;
  total_items: number;
  unknown_items: number;
  unknown_pct: number;
  unknown_eligible: number;
  unknown_hard: number;
};

type DocRow = {
  deal_id: string;
  deal: string;
  document_id: string;
  title: string | null;
  type: string | null;
  total_items: number;
  unknown_items: number;
  unknown_eligible: number;
  unknown_hard: number;
  examples: Array<{
    page_index: number | null;
    page_label: string | null;
    reason: string | null;
    snippet: string | null;
    segment_source: string | null;
    computed_rule_id: string | null;
  }>;
};

type UnknownHotspotsReport = {
  generated_at: string;
  input_dir: string;
  artifact_files: number;
  totals: {
    deals: number;
    total_items: number;
    unknown_items: number;
    unknown_pct: number | null;
    unknown_eligible: number;
    unknown_hard: number;
  };
  top_deals: DealRow[];
  top_documents: DocRow[];
  unknown_reason_counts: Record<string, number>;
  unknown_reason_counts_eligible: Record<string, number>;
  unknown_reason_counts_hard: Record<string, number>;
};

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

function usage() {
  return `unknown-hotspots\n\nReads segment audit lineage artifacts and prints the biggest unknown contributors (deals + documents), split into eligible (LOW_SIGNAL/NO_TEXT/(none)) vs hard unknowns.\n\nUsage:\n  pnpm tsx scripts/unknown-hotspots.ts\n\nOptions:\n  --in-dir        Directory with *.lineage.json (default: artifacts/segment-audit/all-deals)\n  --out-json      Output JSON report path (default: artifacts/segment-audit/all-deals/unknown-hotspots.json)\n  --out-md        Output Markdown report path (default: docs/Active/audit/analizer-debug/segment-audit-all/unknown-hotspots.md)\n  --top-deals     Number of deals to show (default: 10)\n  --top-docs      Number of documents to show (default: 20)\n  --examples      Examples per document (default: 5)\n`;
}

function intArg(v: string | boolean | undefined, defaultValue: number): number {
  if (v == null) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function inc(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function escapeMd(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\|/g, "\\|");
}

function unknownReason(item: SegmentAuditItem): string | null {
  return item.reason?.unknown_reason_code ?? item.computed_reason?.unknown_reason_code ?? null;
}

function unknownBucket(reason: string | null): "eligible" | "hard" {
  return reason == null || reason === "LOW_SIGNAL" || reason === "NO_TEXT" ? "eligible" : "hard";
}

function dealNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.lineage\.json$/i, "");
  // If the filename ends with a full UUID, strip it. Otherwise keep the base name.
  return base.replace(/-[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}$/i, "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(0);
  }

  const inDir = String(args["in-dir"] ?? "artifacts/segment-audit/all-deals");
  const outJson = String(args["out-json"] ?? path.join(inDir, "unknown-hotspots.json"));
  const outMd = String(args["out-md"] ?? "docs/Active/audit/analizer-debug/segment-audit-all/unknown-hotspots.md");
  const topDealsN = intArg(args["top-deals"], 10);
  const topDocsN = intArg(args["top-docs"], 20);
  const examplesN = intArg(args.examples, 5);

  const absIn = path.resolve(process.cwd(), inDir);
  if (!fs.existsSync(absIn)) {
    // eslint-disable-next-line no-console
    console.error(`Missing input directory: ${absIn}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(absIn)
    .filter((f) => f.endsWith(".lineage.json"))
    .sort();

  const perDeal: DealRow[] = [];
  const perDoc: DocRow[] = [];

  const reasonCounts: Record<string, number> = {};
  const reasonCountsEligible: Record<string, number> = {};
  const reasonCountsHard: Record<string, number> = {};

  let totalItems = 0;
  let unknownItems = 0;
  let unknownEligible = 0;
  let unknownHard = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(absIn, file), "utf8");
    const artifact = JSON.parse(raw) as LineageArtifact;

    const dealId = artifact.deal_id;
    const deal = dealNameFromFile(file);

    let dealTotal = 0;
    let dealUnknown = 0;
    let dealEligible = 0;
    let dealHard = 0;

    const docs = artifact.segment_audit_report?.documents ?? [];
    for (const d of docs) {
      let docTotal = 0;
      let docUnknown = 0;
      let docEligible = 0;
      let docHard = 0;

      const examples: DocRow["examples"] = [];

      for (const it of d.items ?? []) {
        docTotal++;
        const seg = it.segment ?? "unknown";
        if (seg !== "unknown") continue;

        docUnknown++;
        const reason = unknownReason(it);
        const bucket = unknownBucket(reason);
        const rk = String(reason ?? "(none)");

        inc(reasonCounts, rk);
        if (bucket === "eligible") {
          docEligible++;
          inc(reasonCountsEligible, rk);
        } else {
          docHard++;
          inc(reasonCountsHard, rk);
        }

        if (examples.length < examplesN) {
          examples.push({
            page_index: it.page_index ?? null,
            page_label: it.page_label ?? null,
            reason: reason,
            snippet: it.snippet ?? null,
            segment_source: it.segment_source ?? null,
            computed_rule_id: it.computed_reason?.rule_id ?? null,
          });
        }
      }

      dealTotal += docTotal;
      dealUnknown += docUnknown;
      dealEligible += docEligible;
      dealHard += docHard;

      if (docUnknown > 0) {
        perDoc.push({
          deal_id: dealId,
          deal,
          document_id: d.document_id,
          title: d.title ?? null,
          type: d.type ?? null,
          total_items: docTotal,
          unknown_items: docUnknown,
          unknown_eligible: docEligible,
          unknown_hard: docHard,
          examples,
        });
      }
    }

    totalItems += dealTotal;
    unknownItems += dealUnknown;
    unknownEligible += dealEligible;
    unknownHard += dealHard;

    perDeal.push({
      deal_id: dealId,
      deal,
      total_items: dealTotal,
      unknown_items: dealUnknown,
      unknown_pct: dealTotal === 0 ? 0 : Number(((dealUnknown * 100) / dealTotal).toFixed(2)),
      unknown_eligible: dealEligible,
      unknown_hard: dealHard,
    });
  }

  perDeal.sort((a, b) => b.unknown_items - a.unknown_items || b.unknown_pct - a.unknown_pct);
  perDoc.sort((a, b) => b.unknown_items - a.unknown_items);

  const report: UnknownHotspotsReport = {
    generated_at: new Date().toISOString(),
    input_dir: inDir,
    artifact_files: files.length,
    totals: {
      deals: perDeal.length,
      total_items: totalItems,
      unknown_items: unknownItems,
      unknown_pct: totalItems === 0 ? null : Number(((unknownItems * 100) / totalItems).toFixed(2)),
      unknown_eligible: unknownEligible,
      unknown_hard: unknownHard,
    },
    top_deals: perDeal.slice(0, topDealsN),
    top_documents: perDoc.slice(0, topDocsN),
    unknown_reason_counts: reasonCounts,
    unknown_reason_counts_eligible: reasonCountsEligible,
    unknown_reason_counts_hard: reasonCountsHard,
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  fs.mkdirSync(path.dirname(outMd), { recursive: true });

  const lines: string[] = [];
  lines.push(`# Unknown hotspots`);
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push(
    `Totals: ${report.totals.unknown_items}/${report.totals.total_items} unknown (${report.totals.unknown_pct ?? "n/a"}%) | eligible=${report.totals.unknown_eligible} hard=${report.totals.unknown_hard}`
  );
  lines.push("");

  lines.push(`## Top deals (by unknown items)`);
  lines.push("");
  lines.push(`| deal | unknown | eligible | hard | total | unknown % |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const d of report.top_deals) {
    lines.push(
      `| ${escapeMd(d.deal)} | ${d.unknown_items} | ${d.unknown_eligible} | ${d.unknown_hard} | ${d.total_items} | ${d.unknown_pct} |`
    );
  }
  lines.push("");

  lines.push(`## Top documents (by unknown items)`);
  lines.push("");
  lines.push(`| deal | document | type | unknown | eligible | hard | total |`);
  lines.push(`|---|---|---|---:|---:|---:|---:|`);
  for (const d of report.top_documents) {
    const title = d.title ? escapeMd(d.title) : "(untitled)";
    lines.push(
      `| ${escapeMd(d.deal)} | ${title} | ${escapeMd(String(d.type ?? "(unknown type)"))} | ${d.unknown_items} | ${d.unknown_eligible} | ${d.unknown_hard} | ${d.total_items} |`
    );
  }
  lines.push("");

  lines.push(`## Unknown reason codes (top 15)`);
  lines.push("");
  const topReasons = Object.entries(report.unknown_reason_counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  lines.push(`| reason | count | eligible | hard |`);
  lines.push(`|---|---:|---:|---:|`);
  for (const [reason, count] of topReasons) {
    lines.push(
      `| ${escapeMd(reason)} | ${count} | ${report.unknown_reason_counts_eligible[reason] ?? 0} | ${report.unknown_reason_counts_hard[reason] ?? 0} |`
    );
  }
  lines.push("");

  lines.push(`## Examples (from top documents)`);
  lines.push("");
  for (const doc of report.top_documents.slice(0, Math.min(10, report.top_documents.length))) {
    const title = doc.title ? escapeMd(doc.title) : "(untitled)";
    lines.push(`### ${escapeMd(doc.deal)} — ${title}`);
    lines.push("");
    for (const ex of doc.examples) {
      const page = ex.page_index == null ? "?" : String(ex.page_index);
      const label = ex.page_label ? escapeMd(ex.page_label) : "(no label)";
      const reason = ex.reason ?? "(none)";
      const src = ex.segment_source ?? "(none)";
      const rule = ex.computed_rule_id ?? "(none)";
      const snip = ex.snippet ? escapeMd(ex.snippet.slice(0, 140)) : "(no snippet)";
      lines.push(`- page=${page} label=${label} reason=${escapeMd(reason)} source=${escapeMd(src)} rule=${escapeMd(rule)} — ${snip}`);
    }
    lines.push("");
  }

  fs.writeFileSync(outMd, lines.join("\n"));

  // eslint-disable-next-line no-console
  console.log(`Wrote JSON: ${outJson}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote Markdown: ${outMd}`);
  // eslint-disable-next-line no-console
  console.log(
    `Totals: ${report.totals.unknown_items}/${report.totals.total_items} unknown (${report.totals.unknown_pct ?? "n/a"}%) | eligible=${report.totals.unknown_eligible} hard=${report.totals.unknown_hard}`
  );
  // eslint-disable-next-line no-console
  console.log(`Top deal: ${report.top_deals[0]?.deal ?? "(none)"} (${report.top_deals[0]?.unknown_items ?? 0} unknown)`);
}

main();
