import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function mdEscapeCodeFence(text) {
  // Prevent accidental triple-backtick termination.
  return String(text).replaceAll("```", "``\\`" );
}

function formatJsonBlock(value) {
  return "```json\n" + mdEscapeCodeFence(JSON.stringify(value, null, 2)) + "\n```";
}

function formatTextBlock(value) {
  return "```text\n" + mdEscapeCodeFence(value ?? "") + "\n```";
}

function asInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  console.log(`Wrote ${path.relative(process.cwd(), filePath)}`);
}

function generateWebMaxDoc({ artifactsDir, outPath }) {
  const srcRel = "artifacts/webmax_scoring_input.json";
  const srcPath = path.join(artifactsDir, "webmax_scoring_input.json");
  const data = readJson(srcPath);

  const items = Array.isArray(data.items) ? data.items : [];
  const pageItems = items
    .filter((it) => it && it.page_index != null)
    .map((it) => ({ ...it, page_index: asInt(it.page_index) }))
    .filter((it) => it.page_index != null);

  const byPage = new Map();
  for (const it of pageItems) {
    const list = byPage.get(it.page_index) ?? [];
    list.push(it);
    byPage.set(it.page_index, list);
  }

  const pages = [...byPage.keys()].sort((a, b) => a - b);

  const lines = [];
  lines.push("# WebMax — Raw per-page extraction inspection");
  lines.push("");
  lines.push("This document is generated from stored artifact outputs (no synthesis). It shows, per page, the extracted `text` and the corresponding `structured_json` that downstream scoring uses.");
  lines.push("");
  lines.push("**Source artifact**");
  lines.push("");
  lines.push(`- ${srcRel}`);
  lines.push("");
  lines.push("## Pages");

  for (const pageIndex of pages) {
    const pageNumber = pageIndex + 1;
    const list = byPage.get(pageIndex) ?? [];

    lines.push("");
    lines.push(`### Page ${pageNumber} (page_index=${pageIndex})`);

    // Preserve original ordering in file as much as possible.
    for (const it of list) {
      lines.push("");
      lines.push(`#### Item: ${it.id ?? "(no id)"}`);
      lines.push("");
      const header = {
        id: it.id ?? null,
        kind: it.kind ?? null,
        source: it.source ?? null,
        document_id: it.document_id ?? null,
        page_index: it.page_index,
        title: it.title ?? null,
        confidence: it.confidence ?? null,
        segment: it.segment ?? null,
        locators: it.locators ?? null,
      };
      lines.push(formatJsonBlock(header));

      lines.push("");
      lines.push("**Extracted text (as stored)**");
      lines.push("");
      lines.push(formatTextBlock(it.text ?? ""));

      lines.push("");
      lines.push("**Parsed JSON (`structured_json`, as stored)**");
      lines.push("");
      lines.push(formatJsonBlock(it.structured_json ?? null));
    }
  }

  writeFile(outPath, lines.join("\n"));
}

function generate3ICEDoc({ artifactsDir, outPath }) {
  const srcTextRel = "artifacts/slide_understanding.3ice_pitch_deck.json";
  const srcTextPath = path.join(artifactsDir, "slide_understanding.3ice_pitch_deck.json");

  const srcLineageRel =
    "artifacts/segment-audit/all-deals/3ice-2bd8864c-b35d-4982-a9e1-83df13385bb1.lineage.json";
  const srcLineagePath = path.join(
    artifactsDir,
    "segment-audit/all-deals/3ice-2bd8864c-b35d-4982-a9e1-83df13385bb1.lineage.json",
  );

  const textDoc = readJson(srcTextPath);
  const lineageDoc = readJson(srcLineagePath);

  const pages = Array.isArray(textDoc?.pdf_v2?.pages) ? textDoc.pdf_v2.pages : [];
  const textByPage = new Map();

  for (const p of pages) {
    const pageIndex = asInt(p?.page_index);
    if (pageIndex == null) continue;
    const finalMethod = p?.final?.method ?? null;
    const finalText = p?.final?.text ?? "";
    const nativeMethod = p?.native?.method ?? null;
    const nativeText = p?.native?.text ?? "";

    textByPage.set(pageIndex, {
      page_index: pageIndex,
      page_number: p?.page_number ?? pageIndex + 1,
      final: { method: finalMethod, text: finalText },
      native: { method: nativeMethod, text: nativeText },
    });
  }

  const nodes = Array.isArray(lineageDoc?.nodes) ? lineageDoc.nodes : [];
  const visualAssets = nodes
    .map((n) => n?.data)
    .filter(Boolean)
    .filter((d) => d.page_index != null)
    .map((d) => ({ ...d, page_index: asInt(d.page_index) }))
    .filter((d) => d.page_index != null);

  const assetsByPage = new Map();
  for (const d of visualAssets) {
    const list = assetsByPage.get(d.page_index) ?? [];
    list.push(d);
    assetsByPage.set(d.page_index, list);
  }

  const allPageIndexes = new Set([...textByPage.keys(), ...assetsByPage.keys()]);
  const sortedPages = [...allPageIndexes].sort((a, b) => a - b);

  const lines = [];
  lines.push("# 3ICE — Raw per-page extraction inspection");
  lines.push("");
  lines.push(
    "This document is generated from stored artifact outputs (no synthesis). For each page, it shows (a) extracted page text from the PDF pipeline and (b) the per-page visual-asset extraction JSON produced by the vision pipeline.",
  );
  lines.push("");
  lines.push("**Source artifacts**");
  lines.push("");
  lines.push(`- ${srcTextRel} (per-page extracted text under \`pdf_v2.pages[].final.text\`)`);
  lines.push(`- ${srcLineageRel} (per-page extraction outputs under \`nodes[].data\`)`);
  lines.push("");
  lines.push("## Pages");

  for (const pageIndex of sortedPages) {
    const pageNumber = pageIndex + 1;
    const text = textByPage.get(pageIndex);
    const assets = assetsByPage.get(pageIndex) ?? [];

    lines.push("");
    lines.push(`### Page ${pageNumber} (page_index=${pageIndex})`);

    if (text) {
      lines.push("");
      lines.push("#### Extracted page text (as stored)");
      lines.push("");
      lines.push(
        formatJsonBlock({
          page_index: text.page_index,
          page_number: text.page_number,
          final_method: text.final.method,
          native_method: text.native.method,
        }),
      );
      lines.push("");
      lines.push("**final.text**");
      lines.push("");
      lines.push(formatTextBlock(text.final.text ?? ""));

      lines.push("");
      lines.push("**native.text**");
      lines.push("");
      lines.push(formatTextBlock(text.native.text ?? ""));
    }

    if (assets.length) {
      lines.push("");
      lines.push("#### Visual-asset extraction outputs (as stored)");

      for (const a of assets) {
        lines.push("");
        lines.push(`##### Asset: ${a.visual_asset_id ?? "(no visual_asset_id)"}`);
        lines.push("");

        const header = {
          visual_asset_id: a.visual_asset_id ?? null,
          document_id: a.document_id ?? null,
          page_index: a.page_index,
          asset_type: a.asset_type ?? null,
          extractor_version: a.extractor_version ?? null,
          extraction_method: a.extraction_method ?? null,
          extraction_confidence: a.extraction_confidence ?? null,
          segment: a.segment ?? null,
          effective_segment: a.effective_segment ?? null,
          segment_source: a.segment_source ?? null,
          segment_confidence: a.segment_confidence ?? null,
          image_uri: a.image_uri ?? null,
          image_hash: a.image_hash ?? null,
          structured_kind: a.structured_kind ?? null,
          structured_summary: a.structured_summary ?? null,
          slide_title: a.slide_title ?? null,
          slide_title_source: a.slide_title_source ?? null,
          slide_title_confidence: a.slide_title_confidence ?? null,
        };

        lines.push(formatJsonBlock(header));

        lines.push("");
        lines.push("**OCR text snippet (as stored)**");
        lines.push("");
        lines.push(formatTextBlock(a.ocr_text_snippet ?? ""));

        lines.push("");
        lines.push("**Parsed JSON (`structured_json`, as stored)**");
        lines.push("");
        lines.push(formatJsonBlock(a.structured_json ?? null));
      }
    }
  }

  writeFile(outPath, lines.join("\n"));
}

const repoRoot = process.cwd();
const artifactsDir = path.join(repoRoot, "artifacts");

generateWebMaxDoc({
  artifactsDir,
  outPath: path.join(repoRoot, "docs/Discovery/WebMax_raw_extraction_inspection.md"),
});

generate3ICEDoc({
  artifactsDir,
  outPath: path.join(repoRoot, "docs/Discovery/3ICE_raw_extraction_inspection.md"),
});
