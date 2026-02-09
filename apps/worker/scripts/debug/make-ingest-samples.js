const fs = require("fs");
const path = require("path");

const outDir = process.env.OUT_DIR || "/tmp/ddai_ingest_samples";
fs.mkdirSync(outDir, { recursive: true });

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const XLSX = require("xlsx");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const pptxgen = require("pptxgenjs");

async function main() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText("DealDecisionAI ingestion test PDF", {
    x: 72,
    y: 720,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  });
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(outDir, "sample.pdf"), Buffer.from(pdfBytes));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Metric", "Value"],
    ["ARR", 1200000],
    ["Burn", 50000],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Summary");
  XLSX.writeFile(wb, path.join(outDir, "sample.xlsx"));

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: "DealDecisionAI ingestion test DOCX", bold: true })],
          }),
          new Paragraph("This is a test document."),
        ],
      },
    ],
  });
  const docxBuf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(outDir, "sample.docx"), docxBuf);

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  const slide = pptx.addSlide();
  slide.addText("DealDecisionAI ingestion test PPTX", {
    x: 0.5,
    y: 1.0,
    w: 12.0,
    h: 1.0,
    fontSize: 28,
  });
  await pptx.writeFile({ fileName: path.join(outDir, "sample.pptx") });

  process.stdout.write(`Wrote samples to ${outDir}\n`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
