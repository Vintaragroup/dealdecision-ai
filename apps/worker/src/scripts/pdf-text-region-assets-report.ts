import fs from "fs";
import path from "path";

import { buildPdfTextRegionStructuredAssetsV1 } from "../lib/pdf_v2/pdf-text-region-assets-v1";

function usage(): never {
	console.error(
		[
			"Usage:",
			"  pnpm -C apps/worker tsx src/scripts/pdf-text-region-assets-report.ts <artifact.json>",
			"",
			"Example:",
			"  pnpm -C apps/worker tsx src/scripts/pdf-text-region-assets-report.ts ../../artifacts/slide_understanding.3ice_pitch_deck.json",
		].join("\n")
	);
	process.exit(2);
}

const fileArg = process.argv[2];
if (!fileArg) usage();

const artifactPath = path.resolve(process.cwd(), fileArg);
const raw = fs.readFileSync(artifactPath, "utf8");
const artifact = JSON.parse(raw);

const pdfV2 = artifact?.pdf_v2;
if (!pdfV2 || typeof pdfV2 !== "object") {
	console.error("Artifact missing pdf_v2 object");
	process.exit(1);
}

const documentId =
	typeof pdfV2.document_id === "string"
		? pdfV2.document_id
		: typeof artifact.doc_id === "string"
			? artifact.doc_id
			: "unknown_document";

const pages = Array.isArray(pdfV2.pages) ? pdfV2.pages : [];

const built = buildPdfTextRegionStructuredAssetsV1({
	documentId,
	dealId: null,
	fullContent: { pdf_v2: pdfV2 },
});

const assetsByPage = new Map<number, number>();
for (const entry of built) {
	assetsByPage.set(entry.pageIndex, (assetsByPage.get(entry.pageIndex) ?? 0) + 1);
}

let totalRegions = 0;
let totalAssets = 0;

for (const page of pages) {
	const pageIndex = typeof page?.page_index === "number" ? page.page_index : null;
	if (pageIndex == null) continue;
	const regions = Array.isArray(page?.understanding_v1?.regions) ? page.understanding_v1.regions : [];
	const regionsCount = regions.length;
	const assetsCount = assetsByPage.get(pageIndex) ?? 0;

	totalRegions += regionsCount;
	totalAssets += assetsCount;

	console.log(
		JSON.stringify({
			page_index: pageIndex,
			regions: regionsCount,
			assets: assetsCount,
		})
	);
}

console.log(
	JSON.stringify({
		document_id: documentId,
		pages: pages.length,
		regions_total: totalRegions,
		assets_total: totalAssets,
	})
);
