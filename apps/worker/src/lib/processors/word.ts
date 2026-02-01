import * as unzipper from "unzipper";
import { parseStringPromise } from "xml2js";

export interface WordContent {
  metadata: {
    title?: string;
    author?: string;
    created?: string;
  };
  sections: Array<{
    heading?: string;
    level: number;
    text: string;
    paragraphs: string[];
    tables: Array<{
      rows: string[][];
    }>;
  }>;
  summary: {
    totalParagraphs: number;
    headings: string[];
    totalText: string;
    tables: number;
  };
}

export async function extractWordContent(buffer: Buffer): Promise<WordContent> {
  const sections: WordContent["sections"] = [];
  const allText: string[] = [];
  const headings: string[] = [];
  let tableCount = 0;

  const textFromXmlNode = (node: any): string => {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (typeof node === "object") {
      // xml2js can represent nodes like: { _: 'Text', $: { 'xml:space': 'preserve' } }
      if (typeof node._ === "string") return node._;
      if (typeof (node as any)["#text"] === "string") return (node as any)["#text"];
    }
    return "";
  };

  try {
    const directory = await unzipper.Open.buffer(buffer);

    // Get document.xml
    const docFile = directory.files.find((f: any) => f.path === "word/document.xml");
    if (!docFile) {
      throw new Error("document.xml not found");
    }

    const content = await docFile.buffer();
    const xmlContent = content.toString();
    const parsed = await parseStringPromise(xmlContent);

    // Extract body elements
    const body = parsed?.["w:document"]?.["w:body"]?.[0];
    if (!body) return { metadata: {}, sections: [], summary: { totalParagraphs: 0, headings, totalText: "", tables: 0 } };

    const elements = body["w:p"] || [];

    for (const para of elements) {
      // Extract heading styles
      const pPr = para["w:pPr"]?.[0];
      const styleId = pPr?.["w:pStyle"]?.[0]?.["$"]?.["w:val"];
      const isHeading = styleId?.includes("Heading");

      // Extract text
      const runs = para["w:r"] || [];
      let paraText = "";

      for (const run of runs) {
        const textNode = run["w:t"]?.[0];
        const text = textFromXmlNode(textNode);
        if (text) paraText += text;
      }

      if (paraText) {
        allText.push(paraText);

        const level = isHeading ? parseInt(styleId?.match(/\d+/)?.[0] || "0") : 999;

        if (isHeading) {
          headings.push(paraText);
        }

        sections.push({
          heading: isHeading ? paraText : undefined,
          level,
          text: paraText,
          paragraphs: [paraText],
          tables: [],
        });
      }
    }

    // Extract tables
    const tables = body["w:tbl"] || [];
    tableCount = tables.length;

    for (const table of tables) {
      const rows = table["w:tr"] || [];
      const tableData: string[][] = [];

      for (const row of rows) {
        const cells = row["w:tc"] || [];
        const rowData: string[] = [];

        for (const cell of cells) {
          const paras = cell["w:p"] || [];
          const cellText = paras
            .map((p: any) => {
              const runs = p["w:r"] || [];
              return runs.map((r: any) => textFromXmlNode(r["w:t"]?.[0]) || "").join("");
            })
            .join(" ");
          rowData.push(cellText);
        }

        tableData.push(rowData);
      }

      sections.push({
        level: 999,
        text: tableData.map((row) => row.join(" | ")).join("\n"),
        paragraphs: tableData.map((row) => row.join(" | ")),
        tables: [{ rows: tableData }],
      });
    }

    return {
      metadata: {},
      sections,
      summary: {
        totalParagraphs: sections.length,
        headings,
        totalText: allText.join(" "),
        tables: tableCount,
      },
    };
  } catch (err) {
    console.error("Word document parsing error:", err);
    throw new Error(`Failed to parse Word document: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
