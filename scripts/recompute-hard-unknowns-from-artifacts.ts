export {};

import fs from "node:fs";
import path from "node:path";

import { classifySegment } from "../apps/api/src/lib/analyst-segment";

type AnyObj = Record<string, any>;

type SegmentAuditItem = {
  visual_asset_id?: string;
  segment?: string;
  segment_confidence?: number | null;
  segment_source?: string;
  extractor_version?: string | null;
  quality_source?: string | null;
  page_index?: number | null;
  snippet?: string | null;
  captured_text?: string | null;
  persisted_segment_key?: string | null;
  computed_segment?: string;
  computed_reason?: AnyObj;
  reason?: AnyObj;
  content_preview?: {
    ocr_text_snippet?: string | null;
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
  return [
    "recompute-hard-unknowns-from-artifacts",
    "",
    "Recomputes ONLY hard-unknown segment audit items in existing *.lineage.json artifacts.",
    "Hard unknowns are those with computed_reason.unknown_reason_code not in (null, LOW_SIGNAL, NO_TEXT).",
    "",
    "This is an offline way to validate classifier improvements without needing Postgres/API.",
    "",
    "Usage:",
    "  pnpm tsx scripts/recompute-hard-unknowns-from-artifacts.ts",
    "",
    "Options:",
    "  --in-dir    Directory with *.lineage.json (default: artifacts/segment-audit/all-deals)",
    "  --dry-run   Print what would change, don’t write files (default: false)",
    "  --limit     Only process first N files (default: all)",
    "  --verbose   Print recompute output for each hard unknown (default: false)",
  ].join("\n");
}

function boolArg(v: string | boolean | undefined, defaultValue: boolean): boolean {
  if (v == null) return defaultValue;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

function intArg(v: string | boolean | undefined, defaultValue: number | null): number | null {
  if (v == null) return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  const i = Math.trunc(n);
  return i > 0 ? i : defaultValue;
}

function unknownReason(item: SegmentAuditItem): string | null {
  const fromReason = item.reason?.unknown_reason_code;
  if (typeof fromReason === "string") return fromReason;
  const fromComputed = item.computed_reason?.unknown_reason_code;
  return typeof fromComputed === "string" ? fromComputed : fromComputed == null ? null : String(fromComputed);
}

function unknownBucket(reason: string | null): "eligible" | "hard" {
  return reason == null || reason === "LOW_SIGNAL" || reason === "NO_TEXT" ? "eligible" : "hard";
}

function buildReasonSummary(debug: AnyObj | undefined): AnyObj {
  if (!debug || typeof debug !== "object") return {};
  return {
    title_text_snippet: debug.title_text_snippet ?? null,
    title_source: debug.title_source ?? null,
    classification_text_len: debug.classification_text_len ?? null,
    classification_text_sources_used: debug.classification_text_sources_used ?? [],
    keyword_hits: debug.keyword_hits ?? {},
    top_scores: debug.top_scores ?? [],
    best_score: debug.best_score ?? null,
    runner_up_score: debug.runner_up_score ?? null,
    threshold: debug.threshold ?? null,
    unknown_reason_code: debug.unknown_reason_code ?? null,
  };
}

function pickBestTextForRescore(item: SegmentAuditItem): string {
  const candidates: Array<unknown> = [
    item?.computed_reason?.classification_text_snippet,
    item?.content_preview?.ocr_text_snippet,
    item?.captured_text,
    item?.snippet,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const s = c.trim();
    if (s.length >= 40) return s;
  }
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const s = c.trim();
    if (s) return s;
  }
  return "";
}

function buildVisualAssetTextIndex(artifact: AnyObj): Map<string, string> {
  const nodes: AnyObj[] = Array.isArray(artifact?.lineage?.nodes)
    ? artifact.lineage.nodes
    : Array.isArray(artifact?.nodes)
      ? artifact.nodes
      : [];

  const out = new Map<string, string>();
  for (const n of nodes) {
    const kind = String(n?.kind ?? n?.node_type ?? "");
    if (kind !== "visual_asset" && kind !== "VISUAL_ASSET") continue;
    const data = n?.data ?? {};
    const visualAssetId =
      (typeof data?.visual_asset_id === "string" && data.visual_asset_id) ||
      (typeof n?.metadata?.visual_asset_id === "string" && n.metadata.visual_asset_id) ||
      null;
    if (!visualAssetId) continue;

    const segDebug = data?.segment_debug ?? {};
    const segFeatures = segDebug?.segment_features ?? {};
    const bestText =
      (typeof segFeatures?.body_text === "string" && segFeatures.body_text.trim()) ||
      (typeof segFeatures?.body === "string" && segFeatures.body.trim()) ||
      (typeof segDebug?.captured_text === "string" && segDebug.captured_text.trim()) ||
      (typeof data?.ocr_text === "string" && data.ocr_text.trim()) ||
      (typeof data?.ocr_text_snippet === "string" && data.ocr_text_snippet.trim()) ||
      "";

    if (!bestText) continue;
    if (!out.has(visualAssetId) || bestText.length > (out.get(visualAssetId)?.length ?? 0)) {
      out.set(visualAssetId, bestText);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(0);
  }

  const inDir = String(args["in-dir"] ?? "artifacts/segment-audit/all-deals");
  const absIn = path.resolve(process.cwd(), inDir);
  const dryRun = boolArg(args["dry-run"], false);
  const limit = intArg(args.limit, null);
  const verbose = boolArg(args.verbose, false);

  if (!fs.existsSync(absIn)) {
    throw new Error(`Missing input directory: ${absIn}`);
  }

  const files = fs
    .readdirSync(absIn)
    .filter((f) => f.endsWith(".lineage.json"))
    .sort();

  const targetFiles = limit == null ? files : files.slice(0, limit);

  let scannedItems = 0;
  let scannedHard = 0;
  let updatedItems = 0;
  let updatedFiles = 0;

  const changeLog: Array<{
    file: string;
    deal_id: string;
    document_id: string;
    page_index: number | null;
    from_segment: string;
    from_reason: string | null;
    to_segment: string;
    to_reason: string | null;
  }> = [];

  for (const file of targetFiles) {
    const fullPath = path.join(absIn, file);
    const raw = fs.readFileSync(fullPath, "utf8");
    const artifact = JSON.parse(raw) as LineageArtifact;

    const visualAssetTextIndex = buildVisualAssetTextIndex(artifact as any);

    const report = artifact.segment_audit_report;
    if (!report || !Array.isArray(report.documents)) continue;

    let didChangeFile = false;

    for (const doc of report.documents) {
      if (!Array.isArray(doc.items)) continue;
      for (const item of doc.items) {
        scannedItems++;

        // Only recompute for items currently unknown + hard unknown reason.
        const currentSeg = typeof item.segment === "string" ? item.segment : "unknown";
        if (currentSeg !== "unknown") continue;

        const reason = unknownReason(item);
        if (unknownBucket(reason) !== "hard") continue;

        scannedHard++;

        const ocrText =
          (typeof item.visual_asset_id === "string" && visualAssetTextIndex.get(item.visual_asset_id)) ||
          pickBestTextForRescore(item);

        const out = classifySegment({
          ocr_text: ocrText,
          page_index: typeof item.page_index === "number" ? item.page_index : null,
          extractor_version: typeof item.extractor_version === "string" ? item.extractor_version : null,
          quality_source: typeof item.quality_source === "string" ? item.quality_source : null,
          enable_debug: true,
          include_debug_text_snippet: true,
          // Match computed_v1 audit behavior: ignore worker-provided segment_key for vision assets.
          disable_structured_segment_key_signal: true,
          disable_structured_segment_key_fallback: true,
        });

        if (verbose) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              {
                file,
                deal_id: artifact.deal_id,
                document_id: doc.document_id,
                page_index: typeof item.page_index === "number" ? item.page_index : null,
                prior_reason: reason,
                recomputed_segment: out.segment,
                recomputed_unknown_reason_code:
                  typeof out?.debug?.unknown_reason_code === "string" ? out.debug.unknown_reason_code : null,
                recomputed_top_scores: out?.debug?.top_scores ?? null,
              },
              null,
              2
            )
          );
        }

        const nextReason = typeof out?.debug?.unknown_reason_code === "string" ? out.debug.unknown_reason_code : null;

        if (out.segment === "unknown") continue;

        item.segment = out.segment;
        item.segment_confidence = out.confidence;
        // Preserve existing segment_source (it carries pipeline meaning in older artifacts)

        item.computed_segment = out.segment;
        item.computed_reason = out.debug ?? null;
        item.reason = buildReasonSummary(out.debug);

        didChangeFile = true;
        updatedItems++;
        changeLog.push({
          file,
          deal_id: artifact.deal_id,
          document_id: doc.document_id,
          page_index: typeof item.page_index === "number" ? item.page_index : null,
          from_segment: currentSeg,
          from_reason: reason,
          to_segment: out.segment,
          to_reason: nextReason,
        });
      }
    }

    if (didChangeFile) {
      updatedFiles++;
      if (!dryRun) {
        fs.writeFileSync(fullPath, JSON.stringify(artifact, null, 2) + "\n");
      }
    }
  }

  const out = {
    in_dir: absIn,
    artifact_files: targetFiles.length,
    scanned_items: scannedItems,
    scanned_hard_unknown_items: scannedHard,
    updated_files: updatedFiles,
    updated_items: updatedItems,
    dry_run: dryRun,
    changes: changeLog,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
