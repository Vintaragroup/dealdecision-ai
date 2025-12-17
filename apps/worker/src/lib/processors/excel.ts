import * as XLSX from "xlsx";

export interface ExcelContent {
  metadata: {
    sheetNames: string[];
    totalSheets: number;
  };
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Record<string, unknown>[];
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

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (jsonData.length === 0) continue;

    const headers = Object.keys(jsonData[0] || {});
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

    sheets.push({
      name: sheetName,
      headers,
      rows: jsonData as Record<string, unknown>[],
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
