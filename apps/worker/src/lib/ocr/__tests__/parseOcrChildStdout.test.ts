import { describe, expect, it } from "vitest";

import { parseOcrChildStdout } from "../safe-tesseract";

describe("parseOcrChildStdout", () => {
	it("parses clean JSON", () => {
		const parsed = parseOcrChildStdout({
			stdout: JSON.stringify({ ok: true, data: { text: "hi" } }) + "\n",
			stderr: "",
			exit: { code: 0, signal: null },
			command: "node",
			argv: ["child.js"],
		});
		expect(parsed.ok).toBe(true);
		expect(parsed.data.text).toBe("hi");
	});

	it("salvages JSON when stdout is noisy", () => {
		const noisyStdout = [
			"Some banner line from a library\n",
			JSON.stringify({ ok: true, data: { text: "extracted" } }),
			"\n",
			"more noise after\n",
		].join("");

		const parsed = parseOcrChildStdout({
			stdout: noisyStdout,
			stderr: "warn: something\n",
			exit: { code: 0, signal: null },
			command: "node",
			argv: ["child.js"],
		});

		expect(parsed.ok).toBe(true);
		expect(parsed.data.text).toBe("extracted");
	});

	it("throws a helpful error when JSON is invalid", () => {
		expect(() =>
			parseOcrChildStdout({
				stdout: "not json at all\n",
				stderr: "some stderr\n",
				exit: { code: 0, signal: null },
				command: "node",
				argv: ["child.js", "--input", "/tmp/x.png"],
			})
		).toThrow(/stdout_preview=/);
	});
});
