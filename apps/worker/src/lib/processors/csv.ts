export type CSVContent = {
	kind: "csv";
	header: string[];
	rows: string[][];
	preview: string;
};

function parseCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			// Escaped quote inside quoted field.
			if (inQuotes && line[i + 1] === '"') {
				cur += '"';
				i++;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (ch === "," && !inQuotes) {
			out.push(cur.trim());
			cur = "";
			continue;
		}
		cur += ch;
	}
	out.push(cur.trim());
	return out;
}

export function extractCSVContent(buffer: Buffer): CSVContent {
	const raw = buffer.toString("utf8");
	// Normalize line endings and drop trailing empty lines.
	const lines = raw
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.map((l) => l.trimEnd())
		.filter((l, idx, arr) => !(l === "" && idx === arr.length - 1));

	const header = lines.length > 0 ? parseCsvLine(lines[0]) : [];
	const rows = lines.slice(1).filter((l) => l.trim() !== "").map(parseCsvLine);
	const preview = lines.slice(0, Math.min(lines.length, 30)).join("\n");

	return {
		kind: "csv",
		header,
		rows,
		preview,
	};
}
