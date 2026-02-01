function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n...TRUNCATED...";
}

function cleanUndefined(obj: Record<string, unknown>) {
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === "undefined") delete obj[k];
  }
}

export function compactForAiSource(input: {
  structuredJson?: unknown;
  ocrText?: string | null;
  ocrBlocks?: unknown;
}): Record<string, unknown> | null {
  const structuredJson = input.structuredJson;
  const ocrText = typeof input.ocrText === "string" ? input.ocrText : null;

  const out: Record<string, unknown> = {};

  if (isRecord(structuredJson)) {
    const sj: any = structuredJson;

    const kind =
      typeof sj.kind === "string"
        ? sj.kind
        : typeof sj.structured_kind === "string"
          ? sj.structured_kind
          : typeof sj.type === "string"
            ? sj.type
            : undefined;

    out.kind = kind;

    const title = typeof sj.title === "string" ? sj.title : typeof sj.sheet_name === "string" ? sj.sheet_name : typeof sj.label === "string" ? sj.label : undefined;
    out.title = title;

    // Common small fields
    if (typeof sj.sheet_name === "string") out.sheet_name = sj.sheet_name;
    if (Array.isArray(sj.headers)) out.headers = sj.headers.slice(0, 120);
    if (sj.units != null) out.units = sj.units;

    // DOCX / text-like payloads
    if (typeof sj.text === "string") out.text = clampText(sj.text, 12_000);
    if (typeof sj.body === "string") out.body = clampText(sj.body, 12_000);
    if (Array.isArray(sj.paragraphs)) out.paragraphs = sj.paragraphs.slice(0, 80);
    if (Array.isArray(sj.bullets)) out.bullets = sj.bullets.slice(0, 120);
    if (typeof sj.notes === "string") out.notes = clampText(sj.notes, 8_000);

    // Excel-ish table
    const table = sj.table;
    if (isRecord(table)) {
      const t: any = table;
      const valueCols = Array.isArray(t.value_cols) ? t.value_cols.slice(0, 48) : undefined;
      const rowsRaw = Array.isArray(t.rows) ? t.rows : undefined;
      const rows = rowsRaw
        ? rowsRaw
            .slice(0, 60)
            .map((r: any) => {
              if (!isRecord(r)) return r;
              if (typeof r.label === "string" && isRecord(r.values)) {
                const values: Record<string, unknown> = {};
                const entries = Object.entries(r.values as Record<string, unknown>).slice(0, 80);
                for (const [k, cell] of entries) {
                  if (!isRecord(cell)) continue;
                  const v = (cell as any).value;
                  const f = (cell as any).formula;
                  if (v != null) values[k] = v;
                  else if (typeof f === "string" && f.trim().length > 0) values[k] = { formula: f.trim() };
                }
                return { label: r.label, values };
              }
              return r;
            })
        : undefined;

      out.table = {
        kind: typeof t.kind === "string" ? t.kind : undefined,
        name: typeof t.name === "string" ? t.name : undefined,
        label_col: typeof t.label_col === "string" ? t.label_col : undefined,
        value_cols: valueCols,
        rows,
      };
    }

    // Generic chart-ish
    if (Array.isArray(sj.series)) out.series = sj.series.slice(0, 24);
    if (Array.isArray(sj.data)) out.data = sj.data.slice(0, 200);
    if (Array.isArray(sj.points)) out.points = sj.points.slice(0, 200);

    // grid_preview is useful for many table-like formats
    const gp = sj.grid_preview;
    if (isRecord(gp) && Array.isArray((gp as any).cells)) {
      out.grid_preview = {
        rows: typeof (gp as any).rows === "number" ? (gp as any).rows : undefined,
        cols: typeof (gp as any).cols === "number" ? (gp as any).cols : undefined,
        row_headers: Array.isArray((gp as any).row_headers) ? (gp as any).row_headers.slice(0, 80) : undefined,
        col_headers: Array.isArray((gp as any).col_headers) ? (gp as any).col_headers.slice(0, 80) : undefined,
        cells: (gp as any).cells.slice(0, 240),
      };
    }

    // Word blocks (structured_word) or generic blocks array
    if (Array.isArray(sj.blocks)) {
      out.blocks = sj.blocks.slice(0, 80).map((b: any) => {
        if (!isRecord(b)) return b;
        const bb: any = b;
        const keep: any = {
          type: typeof bb.type === "string" ? bb.type : undefined,
          heading_level: typeof bb.heading_level === "number" ? bb.heading_level : undefined,
          text: typeof bb.text === "string" ? clampText(bb.text, 4000) : undefined,
          page_index: typeof bb.page_index === "number" ? bb.page_index : undefined,
        };
        cleanUndefined(keep);
        return keep;
      });
    }

    cleanUndefined(out);
  } else if (structuredJson != null) {
    out.kind = typeof structuredJson;
    out.preview = clampText(String(structuredJson), 8000);
    cleanUndefined(out);
  }

  if (ocrText && ocrText.trim().length > 0) {
    out.ocr_text = clampText(ocrText.trim(), 12_000);
  }

  const ocrBlocks = input.ocrBlocks;
  if (isRecord(ocrBlocks) || Array.isArray(ocrBlocks)) {
    // Keep a small sample for grounding.
    const blocks = Array.isArray(ocrBlocks) ? ocrBlocks : (ocrBlocks as any);
    if (Array.isArray(blocks)) {
      out.ocr_blocks = blocks.slice(0, 60);
    }
  }

  cleanUndefined(out);
  if (Object.keys(out).length === 0) return null;
  return out;
}
