import * as XLSX from "xlsx";

type ExcelGridCell = {
  a: string; // A1 address
  v?: unknown;
  w?: string;
  t?: string;
  f?: string;
};

export type ExcelTimeSeriesTable = {
  kind: "time_series";
  name: string;
  range: { start: string; end: string };
  header_row: number;
  label_col: string;
  value_cols: Array<{ col: string; header: string }>;
  rows: Array<{
    label: string;
    values: Record<string, { value?: unknown; formula?: string }>;
  }>;
};

export interface ExcelContent {
  metadata: {
    sheetNames: string[];
    totalSheets: number;
  };
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, unknown>[];
    gridPreview?: {
      maxRows: number;
      maxCols: number;
      cells: ExcelGridCell[];
    };
    tables?: ExcelTimeSeriesTable[];
    formulas: Array<{
      cell: string;
      formula: string;
      result?: unknown;
    }>;
    summary: {
      totalRows: number;
      columnTypes: Record<string, string>;
      numericColumns: string[];
      dateColumns: string[];
    };
  }>;
  summary: {
    totalRows: number;
    numericMetrics: Array<{ sheet: string; column: string; min: number; max: number; avg: number }>;
    dataRelationships: Array<{ from: string; to: string; type: string }>;
  };
}

export function extractExcelContent(buffer: Buffer): ExcelContent {
  const workbook = XLSX.read(buffer, { cellFormula: true, cellStyles: true });
  const sheetNames = workbook.SheetNames;

  const sheets: ExcelContent["sheets"] = [];
  const allNumericMetrics: Array<{ sheet: string; column: string; min: number; max: number; avg: number }> = [];

  const isMonthLike = (s: string): boolean => {
    const t = s.trim().toLowerCase();
    if (!t) return false;
    if (/^month\s*\d+\b/.test(t)) return true;
    if (/^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/.test(t)) {
      return true;
    }
    return false;
  };

  const cellDisplay = (c: any): { v?: unknown; w?: string; t?: string; f?: string; s?: string } => {
    if (!c || typeof c !== "object") return {};
    const v = (c as any).v;
    const w = typeof (c as any).w === "string" ? (c as any).w : undefined;
    const t = typeof (c as any).t === "string" ? (c as any).t : undefined;
    const f = typeof (c as any).f === "string" ? (c as any).f : undefined;
    const s = typeof v === "string" ? v.trim() : typeof w === "string" ? w.trim() : "";
    return { v, w, t, f, s };
  };

  const buildGridPreview = (worksheet: XLSX.WorkSheet, maxRows = 35, maxCols = 12): ExcelContent["sheets"][number]["gridPreview"] => {
    const ref = worksheet["!ref"] as string | undefined;
    if (!ref) return { maxRows, maxCols, cells: [] };
    const r = XLSX.utils.decode_range(ref);
    const endRow = Math.min(r.e.r, r.s.r + (maxRows - 1));
    const endCol = Math.min(r.e.c, r.s.c + (maxCols - 1));
    const cells: ExcelGridCell[] = [];
    for (let rr = r.s.r; rr <= endRow; rr++) {
      for (let cc = r.s.c; cc <= endCol; cc++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        const cellObj = (worksheet as any)[addr];
        const d = cellDisplay(cellObj);
        // Only store non-empty to keep payload lean.
        if (d.v != null || d.f) {
          cells.push({ a: addr, v: d.v, w: d.w, t: d.t, f: d.f });
        }
      }
    }
    return { maxRows, maxCols, cells };
  };

  const buildNormalizedHeadersAndRows = (worksheet: XLSX.WorkSheet): { headers: string[]; rows: Record<string, unknown>[] } => {
    const ref = worksheet["!ref"] as string | undefined;
    if (!ref) return { headers: [], rows: [] };
    const r = XLSX.utils.decode_range(ref);

    const merges = Array.isArray((worksheet as any)["!merges"]) ? ((worksheet as any)["!merges"] as any[]) : [];
    const getMergedTopLeftAddress = (rowIdx: number, colIdx: number): { r: number; c: number } | null => {
      for (const m of merges) {
        const s = m?.s;
        const e = m?.e;
        if (!s || !e) continue;
        if (rowIdx >= s.r && rowIdx <= e.r && colIdx >= s.c && colIdx <= e.c) {
          return { r: s.r, c: s.c };
        }
      }
      return null;
    };

    const normalizeHeaderText = (s: string): string => {
      const t = String(s ?? "").replace(/\s+/g, " ").trim();
      if (!t) return "";
      if (/^__empty\d*$/i.test(t)) return "";
      if (/^empty\d*$/i.test(t)) return "";
      return t;
    };

    const isNonNumericHeaderToken = (w: string): boolean => {
      const t = String(w ?? "").trim();
      if (!t) return false;
      // If the displayed text contains letters, treat it as a header token.
      if (/[a-z]/i.test(t)) return true;
      // Common date-ish shapes used as headers.
      if (/\d{1,4}[\/-]\d{1,2}([\/-]\d{1,4})?/.test(t)) return true;
      if (/\bq\d\b/i.test(t)) return true;
      if (/^fy\s*\d{2,4}$/i.test(t)) return true;
      return false;
    };

    const headerTextFromCell = (d: { v?: unknown; w?: string; t?: string; f?: string; s?: string }): string => {
      if (typeof d.v === "string" && d.v.trim()) return normalizeHeaderText(d.v);
      if (typeof d.w === "string" && isNonNumericHeaderToken(d.w)) return normalizeHeaderText(d.w);
      return "";
    };

    const getCellText = (rowIdx: number, colIdx: number): string => {
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
      const d = cellDisplay((worksheet as any)[addr]);
      const direct = headerTextFromCell(d);
      if (direct) return direct;
      const tl = getMergedTopLeftAddress(rowIdx, colIdx);
      if (!tl) return "";
      const tlAddr = XLSX.utils.encode_cell({ r: tl.r, c: tl.c });
      const dtl = cellDisplay((worksheet as any)[tlAddr]);
      return headerTextFromCell(dtl);
    };

    const maxCols = Math.min(r.e.c, r.s.c + 60);
    const maxHeaderScanRows = Math.min(r.e.r, r.s.r + 10);

    type RowStats = { row: number; nonEmpty: number; nonEmptyStrings: number; nonEmptyNumbers: number };
    const rowStats: RowStats[] = [];
    for (let rr = r.s.r; rr <= maxHeaderScanRows; rr++) {
      let nonEmpty = 0;
      let nonEmptyStrings = 0;
      let nonEmptyNumbers = 0;
      for (let cc = r.s.c; cc <= maxCols; cc++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        const d = cellDisplay((worksheet as any)[addr]);
        const headerText = headerTextFromCell(d);
        if (headerText) {
          nonEmpty += 1;
          nonEmptyStrings += 1;
          continue;
        }
        if (d.v != null || d.f) {
          nonEmpty += 1;
          if (typeof d.v === "number") nonEmptyNumbers += 1;
        }
      }
      rowStats.push({ row: rr, nonEmpty, nonEmptyStrings, nonEmptyNumbers });
    }

    const isHeaderLike = (st: RowStats): boolean => {
      if (st.nonEmpty < 2) return false;
      if (st.nonEmptyStrings < 2) return false;
      const stringRatio = st.nonEmptyStrings / Math.max(1, st.nonEmpty);
      const numericRatio = st.nonEmptyNumbers / Math.max(1, st.nonEmpty);
      if (stringRatio < 0.55) return false;
      if (numericRatio > 0.35) return false;
      return true;
    };

    const headerLikeRows = rowStats.filter(isHeaderLike).map((s) => s.row);
    const headerRows: number[] = [];
    if (headerLikeRows.length > 0) {
      const first = headerLikeRows[0];
      headerRows.push(first);
      if (headerLikeRows.includes(first + 1)) headerRows.push(first + 1);
      if (headerLikeRows.includes(first + 2) && headerRows.length < 2) headerRows.push(first + 2);
    } else {
      headerRows.push(r.s.r);
    }

    const headerPartsByCol = new Map<number, string[]>();
    for (let cc = r.s.c; cc <= maxCols; cc++) headerPartsByCol.set(cc, []);

    for (const hr of headerRows) {
      for (let cc = r.s.c; cc <= maxCols; cc++) {
        const txt = getCellText(hr, cc);
        if (!txt) continue;
        const parts = headerPartsByCol.get(cc) ?? [];
        if (!parts.includes(txt)) parts.push(txt);
        headerPartsByCol.set(cc, parts);
      }
    }

    const headersByCol = new Map<number, string>();
    const headers: string[] = [];
    for (let cc = r.s.c; cc <= maxCols; cc++) {
      const parts = headerPartsByCol.get(cc) ?? [];
      const h = parts.length ? parts.join(" / ") : `col_${XLSX.utils.encode_col(cc)}`;
      headersByCol.set(cc, h);
      headers.push(h);
    }

    const dataStartRow = Math.min(r.e.r, Math.max(...headerRows) + 1);
    const maxDataRows = Math.min(r.e.r, dataStartRow + 2000);
    const rows: Record<string, unknown>[] = [];
    for (let rr = dataStartRow; rr <= maxDataRows; rr++) {
      const obj: Record<string, unknown> = {};
      let hasAny = false;
      for (let cc = r.s.c; cc <= maxCols; cc++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        const d = cellDisplay((worksheet as any)[addr]);
        if (d.v == null && !d.f && !(typeof d.w === "string" && d.w.trim())) continue;
        const key = headersByCol.get(cc) ?? `col_${XLSX.utils.encode_col(cc)}`;
        obj[key] = d.v ?? d.w ?? null;
        hasAny = true;
      }
      if (hasAny) rows.push(obj);
    }

    const usedHeaders = new Set<string>();
    for (const row of rows) {
      for (const k of Object.keys(row)) usedHeaders.add(k);
    }
    const filteredHeaders = headers.filter((h) => usedHeaders.has(h));
    return { headers: filteredHeaders.length ? filteredHeaders : headers, rows };
  };

  const detectTimeSeriesTables = (worksheet: XLSX.WorkSheet, sheetName: string): ExcelTimeSeriesTable[] => {
    const ref = worksheet["!ref"] as string | undefined;
    if (!ref) return [];
    const r = XLSX.utils.decode_range(ref);
    const maxScanRows = Math.min(r.e.r, r.s.r + 200);
    const maxScanCols = Math.min(r.e.c, r.s.c + 50);

    type Candidate = { row: number; startCol: number; endCol: number; headers: Array<{ col: number; header: string }> };
    let best: Candidate | null = null;

    for (let rr = r.s.r; rr <= maxScanRows; rr++) {
      const monthCols: Array<{ col: number; header: string }> = [];
      for (let cc = r.s.c; cc <= maxScanCols; cc++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        const d = cellDisplay((worksheet as any)[addr]);
        const s = d.s ?? "";
        if (s && isMonthLike(s)) {
          monthCols.push({ col: cc, header: s });
        }
      }

      if (monthCols.length < 6) continue;

      // Find the longest contiguous run in monthCols.
      monthCols.sort((a, b) => a.col - b.col);
      let runStart = 0;
      let bestRun: { start: number; end: number } | null = null;
      for (let i = 1; i <= monthCols.length; i++) {
        const prev = monthCols[i - 1];
        const cur = monthCols[i];
        const isBreak = !cur || cur.col !== prev.col + 1;
        if (isBreak) {
          const start = monthCols[runStart].col;
          const end = prev.col;
          if (!bestRun || end - start > bestRun.end - bestRun.start) {
            bestRun = { start, end };
          }
          runStart = i;
        }
      }

      if (!bestRun) continue;
      const headers = monthCols.filter((h) => h.col >= bestRun!.start && h.col <= bestRun!.end);
      if (headers.length < 6) continue;

      // Prefer earlier rows and wider header runs.
      const cand: Candidate = { row: rr, startCol: bestRun.start, endCol: bestRun.end, headers };
      if (!best) {
        best = cand;
      } else {
        const bestWidth = best.endCol - best.startCol;
        const candWidth = cand.endCol - cand.startCol;
        if (candWidth > bestWidth || (candWidth === bestWidth && cand.row < best.row)) {
          best = cand;
        }
      }
    }

    if (!best) return [];

    // Determine label column by scanning left of header run for the strongest text signal.
    let labelColIdx = Math.max(r.s.c, best.startCol - 1);
    let bestSignal = 0;
    for (let cc = Math.max(r.s.c, best.startCol - 1); cc >= r.s.c; cc--) {
      let signal = 0;
      for (let rr = best.row + 1; rr <= Math.min(r.e.r, best.row + 30); rr++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: cc });
        const d = cellDisplay((worksheet as any)[addr]);
        const s = (d.s ?? "").trim();
        if (s) signal += 1;
      }
      if (signal > bestSignal) {
        bestSignal = signal;
        labelColIdx = cc;
      }
    }
    if (bestSignal < 2) labelColIdx = Math.max(r.s.c, best.startCol - 1);
    const labelColLetter = XLSX.utils.encode_col(labelColIdx);
    const valueCols = best.headers.map((h) => ({ col: XLSX.utils.encode_col(h.col), header: h.header }));
    const headerRow1 = best.row + 1;

    const rows: ExcelTimeSeriesTable["rows"] = [];
    let emptyLabelStreak = 0;
    const maxRows = Math.min(r.e.r, best.row + 250);

    for (let rr = headerRow1; rr <= maxRows; rr++) {
      const labelAddr = XLSX.utils.encode_cell({ r: rr, c: labelColIdx });
      const labelCell = cellDisplay((worksheet as any)[labelAddr]);
      const label = (labelCell.s ?? "").trim();

      const values: Record<string, { value?: unknown; formula?: string }> = {};
      let hasAnyValue = false;
      for (const col of best.headers) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: col.col });
        const d = cellDisplay((worksheet as any)[addr]);
        const key = String((d.s && isMonthLike(d.s) ? d.s : "") || col.header);
        values[key] = { value: d.v, formula: d.f };
        if (d.v != null || d.f) hasAnyValue = true;
      }

      // Skip completely empty rows.
      if (!label && !hasAnyValue) {
        emptyLabelStreak += 1;
        if (emptyLabelStreak >= 3 && rows.length > 0) break;
        continue;
      }
      emptyLabelStreak = 0;

      // Require a label for table row; otherwise stop after we've started.
      if (!label) {
        if (rows.length > 0) break;
        continue;
      }

      rows.push({ label, values });
      if (rows.length >= 150) break;
    }

    const startCell = XLSX.utils.encode_cell({ r: best.row, c: labelColIdx });
    const endCell = XLSX.utils.encode_cell({ r: Math.min(best.row + rows.length, r.e.r), c: best.endCol });
    const tableName = `${sheetName}: ${labelColLetter}${best.row + 1}..${labelColLetter}${best.row + rows.length}`;

    return rows.length
      ? [
          {
            kind: "time_series",
            name: tableName,
            range: { start: startCell, end: endCell },
            header_row: best.row + 1,
            label_col: labelColLetter,
            value_cols: valueCols,
            rows,
          },
        ]
      : [];
  };

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const extracted = buildNormalizedHeadersAndRows(worksheet);
    const jsonData = extracted.rows;

    if (jsonData.length === 0) continue;

    const headers = extracted.headers;
    const numericColumns: string[] = [];
    const dateColumns: string[] = [];
    const columnTypes: Record<string, string> = {};

    // Analyze column types
    for (const header of headers) {
      const values = jsonData.map((row: any) => row[header]);
      const nonNull = values.filter((v) => v != null);

      if (nonNull.length === 0) {
        columnTypes[header] = "empty";
        continue;
      }

      const sample = nonNull[0];
      if (typeof sample === "number") {
        columnTypes[header] = "numeric";
        numericColumns.push(header);

        // Calculate statistics for numeric columns
        const numbers = nonNull.filter((v) => typeof v === "number") as number[];
        if (numbers.length > 0) {
          const min = Math.min(...numbers);
          const max = Math.max(...numbers);
          const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
          allNumericMetrics.push({ sheet: sheetName, column: header, min, max, avg });
        }
      } else if (sample instanceof Date || typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample)) {
        columnTypes[header] = "date";
        dateColumns.push(header);
      } else {
        columnTypes[header] = "text";
      }
    }

    // Extract formulas
    const formulas: Array<{ cell: string; formula: string; result?: unknown }> = [];
    for (const cell in worksheet) {
      if (cell.startsWith("!")) continue;
      const cellObj = worksheet[cell];
      if (cellObj.f) {
        formulas.push({
          cell,
          formula: cellObj.f,
          result: cellObj.v,
        });
      }
    }

    const gridPreview = buildGridPreview(worksheet);
    const tables = detectTimeSeriesTables(worksheet, sheetName);

    sheets.push({
      name: sheetName,
      headers,
      rows: jsonData as Record<string, unknown>[],
      gridPreview,
      tables,
      formulas,
      summary: {
        totalRows: jsonData.length,
        columnTypes,
        numericColumns,
        dateColumns,
      },
    });
  }

  return {
    metadata: {
      sheetNames,
      totalSheets: sheetNames.length,
    },
    sheets,
    summary: {
      totalRows: sheets.reduce((sum, s) => sum + s.rows.length, 0),
      numericMetrics: allNumericMetrics,
      dataRelationships: [], // TODO: detect relationships
    },
  };
}
