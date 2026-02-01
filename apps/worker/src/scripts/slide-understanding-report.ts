import fs from "fs/promises";
import path from "path";

type PageRow = {
	page_index: number | null;
	slide_type: string | null;
	title: string;
	evidence_signals: string[];
};

function normalizeText(v: unknown): string {
	if (typeof v !== "string") return "";
	return v.replace(/\s+/g, " ").trim();
}

function parseArgs(argv: string[]) {
	const out: { file: string | null; listPages: boolean } = {
		file: null,
		listPages: false,
	};

	for (let i = 2; i < argv.length; i += 1) {
		const a = argv[i];
		if (!a) continue;
		if (a === "--list" || a === "--pages") {
			out.listPages = true;
			continue;
		}
		if (!out.file) out.file = a;
	}

	return out;
}

function getPages(payload: any): any[] {
	// Supports both harness output (payload.pdf_v2.pages) and raw pdf_v2 artifacts (payload.pages).
	const pv2 = payload?.pdf_v2 && typeof payload.pdf_v2 === "object" ? payload.pdf_v2 : null;
	const pages = Array.isArray(pv2?.pages) ? pv2.pages : Array.isArray(payload?.pages) ? payload.pages : [];
	return Array.isArray(pages) ? pages : [];
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args.file) {
		console.log("Usage: tsx src/scripts/slide-understanding-report.ts <artifact.json> [--list]");
		console.log("Example: pnpm -C apps/worker tsx src/scripts/slide-understanding-report.ts ../../artifacts/slide_understanding.3ice_pitch_deck.json --list");
		process.exit(0);
	}

	const filePath = path.resolve(process.cwd(), args.file);
	const raw = await fs.readFile(filePath, "utf8");
	const payload = JSON.parse(raw);

	const pages = getPages(payload);
	const rows: PageRow[] = pages.map((p: any) => {
		const u = p?.understanding_v1 && typeof p.understanding_v1 === "object" ? p.understanding_v1 : null;
		return {
			page_index: typeof p?.page_index === "number" ? p.page_index : null,
			slide_type: typeof u?.slide_type === "string" ? u.slide_type : null,
			title: normalizeText(u?.title),
			evidence_signals: Array.isArray(u?.evidence_signals) ? u.evidence_signals.filter((s: any) => typeof s === "string") : [],
		};
	});

	const counts = new Map<string, number>();
	for (const r of rows) {
		const k = r.slide_type || "(missing)";
		counts.set(k, (counts.get(k) || 0) + 1);
	}

	const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	console.log(JSON.stringify({ file: filePath, pages: rows.length, slide_type_counts: Object.fromEntries(sortedCounts) }, null, 2));

	if (args.listPages) {
		const byType = new Map<string, PageRow[]>();
		for (const r of rows) {
			const k = r.slide_type || "(missing)";
			const arr = byType.get(k) ?? [];
			arr.push(r);
			byType.set(k, arr);
		}

		for (const [k, arr] of Array.from(byType.entries()).sort((a, b) => (counts.get(b[0]) || 0) - (counts.get(a[0]) || 0) || a[0].localeCompare(b[0]))) {
			console.log("\n==", k, "(", arr.length, ")");
			for (const r of arr) {
				const page = r.page_index != null ? String(r.page_index) : "?";
				const title = r.title ? r.title.slice(0, 120) : "(no title)";
				const sig = r.evidence_signals.length ? ` [${r.evidence_signals.join(",")}]` : "";
				console.log(`- page ${page}: ${title}${sig}`);
			}
		}
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
