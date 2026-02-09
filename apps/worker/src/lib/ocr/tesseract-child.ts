import fs from "node:fs/promises";
import { createRequire } from "node:module";

// `tsx` executes TS as ESM by default, where `require` is undefined.
// In production builds this file may also run as CJS, where `require` exists.
// Use `createRequire` as a safe bridge so module resolution (incl NODE_PATH in tests)
// works consistently.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
declare const require: NodeRequire | undefined;
const localRequireBase = typeof __filename !== "undefined" ? __filename : `${process.cwd()}/tesseract-child.ts`;
const localRequire = typeof require === "function" ? require : createRequire(localRequireBase);

function redirectStdoutWritesToStderr() {
	const origStdoutWrite = process.stdout.write.bind(process.stdout);
	const origStderrWrite = process.stderr.write.bind(process.stderr);
	let allowStdout = false;

	(process.stdout as any).write = ((chunk: any, encoding?: any, cb?: any) => {
		if (allowStdout) return origStdoutWrite(chunk, encoding as any, cb as any);
		try {
			return origStderrWrite(chunk, encoding as any, cb as any);
		} catch {
			return true;
		}
	}) as any;

	return {
		writeJsonToStdout(payload: unknown) {
			allowStdout = true;
			try {
				origStdoutWrite(JSON.stringify(payload) + "\n");
			} finally {
				allowStdout = false;
			}
		},
	};
}

const stdoutCtl = redirectStdoutWritesToStderr();

function redirectConsoleToStderr() {
	const write = (level: string, args: unknown[]) => {
		try {
			const parts = args.map((a) => {
				if (typeof a === "string") return a;
				try {
					return JSON.stringify(a);
				} catch {
					return String(a);
				}
			});
			process.stderr.write(`[ocr:${level}] ${parts.join(" ")}\n`);
		} catch {
			// never throw from logging
		}
	};
	// Critical: keep stdout JSON-only.
	console.log = (...args: unknown[]) => write("log", args);
	console.info = (...args: unknown[]) => write("info", args);
	console.warn = (...args: unknown[]) => write("warn", args);
	console.error = (...args: unknown[]) => write("error", args);
}

function parseArg(flag: string): string | null {
	const idx = process.argv.indexOf(flag);
	if (idx < 0) return null;
	return process.argv[idx + 1] ?? null;
}

async function main(): Promise<void> {
	redirectConsoleToStderr();

	const inputPath = parseArg("--input");
	const lang = parseArg("--lang") ?? "eng";

	if (!inputPath) {
		stdoutCtl.writeJsonToStdout({ ok: false, error: "missing --input" });
		process.exitCode = 2;
		return;
	}

	const buffer = await fs.readFile(inputPath);

	// Import after console redirection so any library banners/warnings go to stderr.
	const Tesseract = localRequire("tesseract.js") as typeof import("tesseract.js");

	// Critical: run OCR in this process so a native abort only kills the child.
	const result = await Tesseract.recognize(buffer as any, lang, { logger: () => {} });
	const data = result?.data ?? {};

	// Keep the JSON payload small and stable: tesseract.js words can contain deeply nested
	// symbol/choice trees that easily exceed parent stdout caps.
	const normalizeBbox = (bbox: any) => {
		if (!bbox || typeof bbox !== "object") return null;
		const x0 = Number(bbox.x0 ?? bbox.left ?? 0);
		const y0 = Number(bbox.y0 ?? bbox.top ?? 0);
		const x1 = Number(bbox.x1 ?? bbox.right ?? 0);
		const y1 = Number(bbox.y1 ?? bbox.bottom ?? 0);
		return { x0, y0, x1, y1 };
	};
	const cap = <T>(arr: T[], max = 10_000) => (arr.length > max ? arr.slice(0, max) : arr);

	const wordsRaw = Array.isArray((data as any).words) ? (data as any).words : [];
	const linesRaw = Array.isArray((data as any).lines) ? (data as any).lines : [];

	const words = cap(wordsRaw).map((w: any) => ({
		text: typeof w?.text === "string" ? w.text : "",
		confidence: Number(w?.confidence ?? w?.conf ?? 0),
		bbox: normalizeBbox(w?.bbox),
	}));
	const lines = cap(linesRaw).map((l: any) => ({
		text: typeof l?.text === "string" ? l.text : "",
		confidence: Number(l?.confidence ?? l?.conf ?? 0),
		bbox: normalizeBbox(l?.bbox),
	}));

	stdoutCtl.writeJsonToStdout({
		ok: true,
		data: {
			text: data.text ?? "",
			confidence: data.confidence ?? 0,
			words,
			lines,
		},
	});
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	// Keep stdout JSON-only.
	stdoutCtl.writeJsonToStdout({ ok: false, error: msg });
	process.exitCode = 1;
});
