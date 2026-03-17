/**
 * Vision image URI helpers: resolving local paths, reading raw bytes for
 * submission to the vision worker, and probing URI fetch-ability.
 *
 * Extracted from index.ts so extract_visuals, deep_scan_visuals and other
 * processors can import without depending on the monolithic index module.
 */

import path from "path";
import fs from "fs/promises";

import { probeImageUriFetchability, type ImageUriFetchDiag } from "./visual-extraction";

export type HeadCheckResult =
	| ImageUriFetchDiag
	| {
			ok: boolean;
			status: number | null;
			content_type: string | null;
			duration_ms: number;
			method: "FILE";
			error?: string;
	  };

export function resolveLocalImagePath(
	imageUri: string,
	env: NodeJS.ProcessEnv = process.env
): string | null {
	const trimmed = String(imageUri || "").trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;
	if (trimmed.startsWith("/uploads/")) {
		const uploadDir = env.UPLOAD_DIR
			? path.resolve(env.UPLOAD_DIR)
			: path.resolve(process.cwd(), "uploads");
		return path.join(uploadDir, trimmed.slice("/uploads".length));
	}
	if (trimmed.startsWith("/")) return trimmed;
	// Treat relative paths as relative to cwd.
	return path.resolve(process.cwd(), trimmed);
}

export async function tryReadImageB64ForVision(
	imageUri: string,
	env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
	// Policy: NEVER embed base64 for HTTP(S) URIs; always prefer image_uri-only.
	const trimmed = String(imageUri || "").trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;

	const localPath = resolveLocalImagePath(imageUri, env);
	if (!localPath) return null;
	try {
		const bytes = await fs.readFile(localPath);
		if (!bytes || bytes.length === 0) return null;
		return bytes.toString("base64");
	} catch {
		return null;
	}
}

export async function headCheckImageUri(uri: string): Promise<HeadCheckResult> {
	const u = String(uri || "").trim();
	if (!u) {
		return {
			ok: false,
			status: null,
			content_type: null,
			duration_ms: 0,
			method: "GET_RANGE",
			error: "empty_uri",
		} as ImageUriFetchDiag;
	}

	const started = Date.now();

	// Local-dev / docker-dev: we often pass a shared-volume filesystem path
	// (e.g. /app/uploads/.../page_0000.png) through to the vision service.
	// Treat absolute paths and file:// URIs as local files.
	let localPath: string | null = null;
	if (u.startsWith("file://")) {
		try {
			localPath = new URL(u).pathname;
		} catch {
			localPath = null;
		}
	} else if (path.isAbsolute(u)) {
		localPath = u;
	}
	if (localPath) {
		try {
			await fs.access(localPath);
			const ext = path.extname(localPath).toLowerCase();
			const ct =
				ext === ".png"
					? "image/png"
					: ext === ".jpg" || ext === ".jpeg"
						? "image/jpeg"
						: ext === ".webp"
							? "image/webp"
							: null;
			return {
				ok: true,
				status: 200,
				content_type: ct,
				duration_ms: Date.now() - started,
				method: "FILE",
			};
		} catch (err) {
			return {
				ok: false,
				status: 404,
				content_type: null,
				duration_ms: Date.now() - started,
				method: "FILE",
				error: err instanceof Error ? err.message : "file_not_found",
			};
		}
	}

	if (!u.startsWith("http://") && !u.startsWith("https://")) {
		return {
			ok: false,
			status: null,
			content_type: null,
			duration_ms: Date.now() - started,
			method: "GET_RANGE",
			error: "unsupported_uri",
		} as ImageUriFetchDiag;
	}
	return await probeImageUriFetchability(u, { timeoutMs: 5000 });
}
