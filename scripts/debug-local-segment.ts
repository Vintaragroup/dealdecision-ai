export {};

import fs from "node:fs";
import path from "node:path";

import { classifySegment } from "../apps/api/src/lib/analyst-segment";

type AnyObj = Record<string, any>;

function usage(): never {
  console.error(
    [
      "Usage:",
      "  pnpm -s exec tsx scripts/debug-local-segment.ts <lineage.json> [document_id] [page_index]",
      "",
      "Defaults:",
      "  lineage.json: artifacts/segment-audit/all-deals/vintara-group-llc-086866a6-f329-45bf-abcb-e67b0326b149.lineage.json",
      "  document_id: e3c95d3a-eda6-4543-8349-a056b9acc51a",
      "  page_index: 9",
    ].join("\n")
  );
  process.exit(2);
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function main() {
  const lineagePath = process.argv[2];
  const documentId = process.argv[3] ?? "e3c95d3a-eda6-4543-8349-a056b9acc51a";
  const pageIndex = toInt(process.argv[4] ?? "9");

  const defaultLineagePath =
    "artifacts/segment-audit/all-deals/vintara-group-llc-086866a6-f329-45bf-abcb-e67b0326b149.lineage.json";

  const resolvedPath = path.resolve(process.cwd(), lineagePath ?? defaultLineagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Lineage file not found: ${resolvedPath}`);
    usage();
  }
  if (pageIndex === null || pageIndex < 0) usage();

  const raw = fs.readFileSync(resolvedPath, "utf8");
  const j = JSON.parse(raw) as AnyObj;

  const nodes: AnyObj[] = Array.isArray(j?.lineage?.nodes) ? j.lineage.nodes : Array.isArray(j?.nodes) ? j.nodes : [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error(`No nodes found in ${resolvedPath} (expected lineage.nodes[])`);
  }

  const candidates = nodes.filter((n) => {
    const docOk = String(n?.document_id ?? n?.metadata?.document_id ?? "") === documentId;
    const pageOk = (n?.metadata?.page_index ?? n?.data?.page_index) === pageIndex;
    const kindOk = String(n?.kind ?? "") === "visual_asset" || String(n?.node_type ?? "") === "VISUAL_ASSET";
    const assetType = String(n?.data?.asset_type ?? n?.metadata?.asset_type ?? "");
    return kindOk && docOk && pageOk && assetType === "image_text";
  });

  if (candidates.length === 0) {
    throw new Error(
      `No matching visual_asset nodes for document_id=${documentId} page_index=${pageIndex} in ${resolvedPath}`
    );
  }

  // Prefer a node that already includes segment_debug.segment_features (best fidelity for offline rescoring)
  const node = candidates.find((c) => c?.data?.segment_debug?.segment_features) ?? candidates[0];
  const data = node?.data ?? {};
  const segDebug = data?.segment_debug ?? {};
  const segFeatures = segDebug?.segment_features ?? {};

  const ocrText =
    (typeof segFeatures?.body_text === "string" && segFeatures.body_text.trim()) ||
    (typeof segFeatures?.body === "string" && segFeatures.body.trim()) ||
    (typeof segDebug?.captured_text === "string" && segDebug.captured_text.trim()) ||
    (typeof data?.ocr_text === "string" && data.ocr_text.trim()) ||
    "";

  const out = classifySegment({
    ocr_text: ocrText,
    ocr_snippet: typeof data?.ocr_text_snippet === "string" ? data.ocr_text_snippet : null,
    structured_kind: typeof data?.structured_kind === "string" ? data.structured_kind : null,
    structured_summary: data?.structured_summary ?? null,
    structured_json: data?.structured_json ?? null,
    asset_type: typeof data?.asset_type === "string" ? data.asset_type : null,
    page_index: typeof data?.page_index === "number" ? data.page_index : pageIndex,
    slide_title: typeof data?.slide_title === "string" ? data.slide_title : null,
    slide_title_confidence: typeof data?.slide_title_confidence === "number" ? data.slide_title_confidence : null,
    evidence_snippets: Array.isArray(data?.evidence_snippets) ? data.evidence_snippets : [],
    extractor_version: typeof data?.extractor_version === "string" ? data.extractor_version : null,
    quality_source: data?.quality_flags?.source ?? null,
    enable_debug: true,
    include_debug_text_snippet: true,
    // Match computed_v1 behavior: ignore worker-provided segment_key for vision assets.
    disable_structured_segment_key_signal: true,
    disable_structured_segment_key_fallback: true,
  });

  const writePath = path.resolve(process.cwd(), "artifacts/tmp_local_segment_debug.json");
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(
    writePath,
    JSON.stringify(
      {
        lineage_file: resolvedPath,
        document_id: documentId,
        page_index: pageIndex,
        visual_asset_id: data?.visual_asset_id ?? node?.metadata?.visual_asset_id ?? null,
        prior: {
          computed_segment: data?.computed_segment ?? null,
          computed_reason: data?.computed_reason ?? null,
          segment_source: data?.segment_source ?? null,
          segment_debug_unknown_reason_code: segDebug?.unknown_reason_code ?? null,
        },
        recomputed: out,
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        wrote: writePath,
        segment: out.segment,
        confidence: out.confidence,
        unknown_reason_code: out?.debug?.unknown_reason_code ?? null,
        best_score: out?.debug?.best_score ?? null,
        runner_up_score: out?.debug?.runner_up_score ?? null,
        tie_delta: out?.debug?.tie_delta ?? null,
        top_scores: out?.debug?.top_scores ?? null,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
