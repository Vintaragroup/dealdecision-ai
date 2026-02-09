import { describe, expect, it } from "vitest";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

async function runChild(opts: {
	workerRoot: string;
	nodePathDir: string;
	inputPath: string;
	nodeOptions?: string;
}) {
	const childTs = path.join(opts.workerRoot, "src", "lib", "ocr", "tesseract-child.ts");

	let stdout = "";
	let stderr = "";

	const child = spawn("pnpm", ["exec", "tsx", childTs, "--input", opts.inputPath, "--lang", "eng"], {
		cwd: opts.workerRoot,
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			NODE_PATH: opts.nodePathDir,
			NODE_OPTIONS: [process.env.NODE_OPTIONS ?? "", opts.nodeOptions ?? ""].filter(Boolean).join(" "),
		},
	});

	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");

	child.stdout?.on("data", (c) => (stdout += String(c)));
	child.stderr?.on("data", (c) => (stderr += String(c)));

	const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => resolve({ code, signal }));
	});

	return { stdout, stderr, exit };
}

describe("tesseract-child stdout JSON contract", () => {
	it("emits a single complete JSON value on stdout even if dependencies write fragments", async () => {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const workerRoot = path.resolve(here, "../../../../");

		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ddai_tesseract_child_test_"));
		try {
			// Preload a hook that stubs `tesseract.js` even though it's installed in node_modules.
			// NODE_PATH does not override already-resolvable deps, so we intercept Module._load.
			const hookPath = path.join(tmp, "preload-hook.cjs");
			await fs.writeFile(
				hookPath,
				[
					"const Module = require('module');",
					"const originalLoad = Module._load;",
					"Module._load = function(request, parent, isMain) {",
					"  if (request === 'tesseract.js') {",
					"    return {",
					"      recognize: async () => {",
					"        // Simulate a dependency writing a JSON fragment to stdout.",
					"        process.stdout.write(',\\\"confidence\\\":99');",
					"        return { data: { text: 'hello', confidence: 99, words: [], lines: [] } };",
					"      }",
					"    };",
					"  }",
					"  return originalLoad.apply(this, arguments);",
					"};",
				].join("\n"),
				"utf8"
			);

			const inputPath = path.join(tmp, "input.bin");
			await fs.writeFile(inputPath, Buffer.from("fake"));

			const { stdout, stderr, exit } = await runChild({
				workerRoot,
				nodePathDir: tmp,
				inputPath,
				nodeOptions: `--require ${hookPath}`,
			});
				expect(exit.signal).toBeNull();
				expect(
					exit.code,
					[`child stdout:\n${stdout}`, `child stderr:\n${stderr}`].join("\n\n")
				).toBe(0);

				// Stdout must be parseable JSON and start with { or [.
				expect(stdout.trim().length).toBeGreaterThan(0);
				expect(["{", "["].includes(stdout.trim()[0]!)).toBe(true);
				const parsed = JSON.parse(stdout.trim());
				expect(typeof parsed.ok).toBe("boolean");
				expect(parsed.ok).toBe(true);
				expect(parsed.data.text).toBe("hello");

				// The junk fragment should have been diverted to stderr.
				expect(stderr).toMatch(/"confidence":99/);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});
