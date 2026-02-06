import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SafeTesseractData = {
	text?: string;
	confidence?: number;
	words?: any[];
	lines?: any[];
};

function previewText(s: string, maxBytes: number): string {
	const clipped = s.length > maxBytes ? s.slice(0, maxBytes) : s;
	// Make control characters visible.
	return clipped.replace(/[\u0000-\u001f\u007f]/g, (c) => {
		const code = c.charCodeAt(0);
		return `\\x${code.toString(16).padStart(2, "0")}`;
	});
}

export function parseOcrChildStdout(params: {
	stdout: string;
	stderr: string;
	exit: { code: number | null; signal: NodeJS.Signals | null };
	command: string;
	argv: string[];
}): any {
	const raw = typeof params.stdout === "string" ? params.stdout : "";
	const trimmed = raw.trim();
	const tryParse = (s: string) => JSON.parse(s);

	try {
		return tryParse(trimmed || "{}");
	} catch (err) {
		// Optional salvage: extract the last JSON object in stdout.
		const first = raw.indexOf("{");
		const last = raw.lastIndexOf("}");
		if (first >= 0 && last > first) {
			const candidate = raw.slice(first, last + 1).trim();
			try {
				const parsed = tryParse(candidate);
				if (parsed && typeof parsed === "object" && typeof (parsed as any).ok === "boolean") {
					return parsed;
				}
			} catch {
				// fall through
			}
		}

		const msg = err instanceof Error ? err.message : String(err);
		const stdoutPreview = previewText(raw, 2048);
		const stderrPreview = previewText(params.stderr || "", 2048);
		throw new Error(
			[
				`OCR child returned non-JSON output (exit=${params.exit.code ?? "null"}, signal=${params.exit.signal ?? "null"})`,
				`parse_error=${msg}`,
				`command=${params.command}`,
				`argv=${JSON.stringify(params.argv)}`,
				`stdout_preview=${JSON.stringify(stdoutPreview)}`,
				`stderr_preview=${JSON.stringify(stderrPreview)}`,
			].join(" ")
		);
	}
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

export async function safeTesseractRecognizeBuffer(options: {
	buffer: Buffer;
	lang?: string;
	timeoutMs: number;
}): Promise<SafeTesseractData> {
	const lang = options.lang ?? "eng";
	const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ddai_ocr_"));
	const inputPath = path.join(tmpRoot, "input.bin");

	let childStdout = "";
	let childStderr = "";
	let timedOut = false;

	try {
		await fs.writeFile(inputPath, options.buffer);

		// Prefer compiled child when available; in dev `__dirname` points to src and the
		// compiled file doesn't exist, so fall back to a generated JS child script.
		const overrideChild = typeof process.env.DDAI_TESSERACT_CHILD_OVERRIDE === "string"
			? process.env.DDAI_TESSERACT_CHILD_OVERRIDE.trim()
			: "";
		const compiledChild = path.join(__dirname, "tesseract-child.js");
		let argv: string[];
		let command: string;

		if (overrideChild) {
			command = process.execPath;
			argv = [overrideChild, "--input", inputPath, "--lang", lang];
		} else if (await fileExists(compiledChild)) {
			command = process.execPath;
			argv = [compiledChild, "--input", inputPath, "--lang", lang];
		} else {
			const childPath = path.join(tmpRoot, "tesseract-child.js");
			await fs.writeFile(
				childPath,
				[
					"const fs = require('node:fs');",
					"const origStdoutWrite = process.stdout.write.bind(process.stdout);",
					"const origStderrWrite = process.stderr.write.bind(process.stderr);",
					"let __allowStdout = false;",
					"process.stdout.write = (chunk, enc, cb) => { if(__allowStdout) return origStdoutWrite(chunk, enc, cb); try{ return origStderrWrite(chunk, enc, cb); }catch(e){ return true; } };",
					"function writeJson(payload){ __allowStdout = true; try{ origStdoutWrite(JSON.stringify(payload) + '\\n'); } finally { __allowStdout = false; } }",
					"function toErr(level, args){ try{ const s=args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' '); process.stderr.write('[ocr:'+level+'] '+s+'\\n'); }catch(e){} }",
					"console.log=(...a)=>toErr('log',a); console.info=(...a)=>toErr('info',a); console.warn=(...a)=>toErr('warn',a); console.error=(...a)=>toErr('error',a);",
					"const Tesseract = require('tesseract.js');",
					"function normalizeBbox(b){ if(!b||typeof b!=='object') return null; const x0=Number(b.x0??b.left??0); const y0=Number(b.y0??b.top??0); const x1=Number(b.x1??b.right??0); const y1=Number(b.y1??b.bottom??0); return {x0,y0,x1,y1}; }",
					"function cap(arr,max){ return (Array.isArray(arr)&&arr.length>max) ? arr.slice(0,max) : (Array.isArray(arr)?arr:[]); }",
					"function slimWord(w){ return { text: (w&&typeof w.text==='string')?w.text:'', confidence: Number((w&& (w.confidence??w.conf)) ?? 0), bbox: normalizeBbox(w&&w.bbox) }; }",
					"function slimLine(l){ return { text: (l&&typeof l.text==='string')?l.text:'', confidence: Number((l&& (l.confidence??l.conf)) ?? 0), bbox: normalizeBbox(l&&l.bbox) }; }",
					"function arg(flag){ const i=process.argv.indexOf(flag); return i>=0 ? (process.argv[i+1]||null) : null; }",
					"(async () => {",
					"  const input = arg('--input');",
					"  const lang = arg('--lang') || 'eng';",
					"  if(!input){ writeJson({ok:false,error:'missing --input'}); process.exit(2); return; }",
					"  const buf = fs.readFileSync(input);",
					"  const result = await Tesseract.recognize(buf, lang, { logger: () => {} });",
					"  const data = (result && result.data) ? result.data : {};",
					"  const words = cap(data.words, 10000).map(slimWord);",
					"  const lines = cap(data.lines, 10000).map(slimLine);",
					"  writeJson({ ok:true, data:{ text:data.text||'', confidence:data.confidence||0, words, lines } });",
					"})().catch((err) => {",
					"  const msg = (err && err.message) ? err.message : String(err);",
					"  writeJson({ ok:false, error: msg });",
					"  process.exit(1);",
					"});",
				].join("\n"),
				"utf8"
			);
			command = process.execPath;
			argv = [childPath, "--input", inputPath, "--lang", lang];
		}

		const child = spawn(command, argv, {
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				DDAI_TESSERACT_CHILD: "1",
			},
		});

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");

		child.stdout?.on("data", (chunk) => {
			childStdout += String(chunk);
			if (childStdout.length > 512_000) childStdout = childStdout.slice(-512_000);
		});
		child.stderr?.on("data", (chunk) => {
			childStderr += String(chunk);
			if (childStderr.length > 64_000) childStderr = childStderr.slice(-64_000);
		});

		const exit: { code: number | null; signal: NodeJS.Signals | null } =
			await new Promise((resolve, reject) => {
				const t = setTimeout(() => {
					timedOut = true;
					try {
						child.kill("SIGKILL");
					} catch {
						// ignore
					}
					resolve({ code: null, signal: "SIGKILL" });
				}, options.timeoutMs);
				child.on("error", (err) => {
					clearTimeout(t);
					reject(err);
				});
				child.on("exit", (code, signal) => {
					clearTimeout(t);
					resolve({ code, signal });
				});
			});

		if (timedOut) {
			throw new Error(`OCR timed out after ${options.timeoutMs}ms`);
		}

		const parsed = parseOcrChildStdout({
			stdout: childStdout,
			stderr: childStderr,
			exit,
			command,
			argv,
		});

		if (!parsed?.ok) {
			const childMsg =
				typeof parsed?.error === "string" && parsed.error.trim().length
					? parsed.error.trim()
					: "OCR child failed";
			const details = childStderr.trim();
			throw new Error(details ? `${childMsg}: ${details}` : childMsg);
		}

		return (parsed.data ?? {}) as SafeTesseractData;
	} finally {
		try {
			await fs.rm(tmpRoot, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
}
