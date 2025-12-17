import * as pdfjs from "pdfjs-dist";

export interface PDFContent {
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creationDate?: string;
    pages: number;
  };
  pages: Array<{
    pageNumber: number;
    text: string;
    words: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    tables: Array<{
      rows: string[][];
      confidence: number;
    }>;
  }>;
  summary: {
    totalWords: number;
    totalPages: number;
    mainHeadings: string[];
    keyNumbers: Array<{ value: string; context: string }>;
  };
}

export async function extractPDFContent(buffer: Buffer): Promise<PDFContent> {
  // Use pdf.js worker
  const worker = await pdfjs.getDocument(buffer).promise;
  const metadata = await worker.getMetadata().catch(() => ({}));

  const pages: PDFContent["pages"] = [];
  const allWords: string[] = [];
  const headings: Set<string> = new Set();
  const numbers: Array<{ value: string; context: string }> = [];

  for (let i = 1; i <= worker.numPages; i++) {
    const page = await worker.getPage(i);
    const textContent = await page.getTextContent();

    // Extract text with positioning
    const words = textContent.items
      .filter((item): item is pdfjs.TextItem => "str" in item)
      .map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }));

    const pageText = words.map((w) => w.text).join(" ");
    allWords.push(...pageText.split(/\s+/));

    // Detect headings (larger text at start of lines)
    const headingCandidates = words
      .filter((w) => w.height > 12 && w.text.length > 3)
      .slice(0, 3);

    headingCandidates.forEach((h) => {
      if (!headings.has(h.text)) {
        headings.add(h.text);
      }
    });

    // Extract numbers with context
    const numberMatches = pageText.matchAll(/(\$[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?%|[\d,]+(?:\.\d+)?[KMB]?)/g);
    for (const match of numberMatches) {
      const idx = pageText.indexOf(match[0]);
      const contextStart = Math.max(0, idx - 50);
      const contextEnd = Math.min(pageText.length, idx + 50);
      const context = pageText.substring(contextStart, contextEnd).trim();
      numbers.push({ value: match[0], context });
    }

    pages.push({
      pageNumber: i,
      text: pageText,
      words,
      tables: [], // TODO: table detection
    });
  }

  return {
    metadata: {
      title: (metadata as any)?.title || undefined,
      author: (metadata as any)?.author || undefined,
      subject: (metadata as any)?.subject || undefined,
      creationDate: (metadata as any)?.creationDate || undefined,
      pages: worker.numPages,
    },
    pages,
    summary: {
      totalWords: allWords.length,
      totalPages: worker.numPages,
      mainHeadings: Array.from(headings).slice(0, 10),
      keyNumbers: numbers.slice(0, 20),
    },
  };
}
