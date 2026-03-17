// visual-extraction/page-uri-resolver.ts
// resolvePageImageUris, backfillVisualAssetImageUris, hasTable — verbatim extraction.

import type { Pool } from "pg";
import path from "path";
import fs from "fs/promises";
import { sanitizeText } from "@dealdecision/core";
import { getR2ObjectUrl, r2ObjectExists } from "../r2";
import type { VisionExtractorConfig, VisionExtractResponse } from "./types";
import { normalizeImageUriForDb } from "./_shared";

type LogLike = Pick<Console, "log" | "warn" | "error">;
type FsLike = Pick<typeof fs, "readdir" | "stat">;

function safeDocIdForPath(documentId: string): string {
	return String(documentId || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function dirExists(fsImpl: FsLike, dir: string): Promise<boolean> {
	try {
		const s = await fsImpl.stat(dir);
		return s.isDirectory();
	} catch {
		return false;
	}
}

function candidateArtifactDirs(params: {
	documentId: string;
	meta?: unknown;
	env?: NodeJS.ProcessEnv;
}): string[] {
	const env = params.env ?? process.env;
	const safeId = safeDocIdForPath(params.documentId);
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");

	const dirs: string[] = [];
	const metaObj = params.meta && typeof params.meta === "object" ? (params.meta as any) : null;
	for (const key of ["debug_dir", "debugDir", "artifacts_dir", "artifactsDir", "rendered_pages_dir", "renderedPagesDir"]) {
		const v = metaObj?.[key];
		if (typeof v !== "string" || !v.trim()) continue;
		const trimmed = v.trim();
		// In a separated API+worker setup (e.g. Render), documents.extraction_metadata may contain
		// an absolute path from the API service filesystem. The worker must not depend on that path.
		// Only consider absolute paths that live under the worker's UPLOAD_DIR.
		if (path.isAbsolute(trimmed)) {
			try {
				const abs = path.resolve(trimmed);
				const rel = path.relative(uploadDir, abs);
				const isUnderUploadDir = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
				if (!isUnderUploadDir) continue;
			} catch {
				continue;
			}
		}
		dirs.push(trimmed);
	}

	// Known extractor debug location (only exists if PDF_EXTRACT_DEBUG=1 at extraction time)
	dirs.push(path.join("/tmp/pdf_extract_debug", safeId));

	// Common “uploads/artifacts” patterns (best-effort; may not exist)
	dirs.push(path.join(uploadDir, "rendered_pages", safeId));
	dirs.push(path.join(uploadDir, "page_images", safeId));
	dirs.push(path.join(uploadDir, "extracted_images", safeId));
	dirs.push(path.join(uploadDir, "artifacts", safeId, "pages"));
	dirs.push(path.join(uploadDir, "artifacts", safeId));
	dirs.push(path.join(uploadDir, safeId, "pages"));
	dirs.push(path.join(uploadDir, safeId));

	// Dedupe while preserving order
	return Array.from(new Set(dirs));
}

function parsePageIndexFromFilename(fileName: string): number | null {
	const name = fileName.toLowerCase();
	if (!(name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) return null;

	// Examples: page_001_raw.png, page-12.png, page12.jpg
	const m = name.match(/page[_\-]?0*(\d{1,6})/);
	if (!m) return null;
	const n = Number.parseInt(m[1], 10);
	return Number.isFinite(n) ? n : null;
}

function pickBestPerPage(candidates: string[]): string {
	// Prefer “raw” over “pre” over anything else.
	const rank = (p: string) => {
		const n = p.toLowerCase();
		if (n.includes("_raw")) return 3;
		if (n.includes("_pre")) return 2;
		return 1;
	};
	return candidates.sort((a, b) => rank(b) - rank(a))[0];
}

export async function resolvePageImageUris(
	pool: Pool,
	documentId: string,
	options?: {
		logger?: LogLike;
		fsImpl?: FsLike;
		env?: NodeJS.ProcessEnv;
	}
): Promise<string[]> {
	const logger = options?.logger ?? console;
	const fsImpl = options?.fsImpl ?? fs;
	const env = options?.env ?? process.env;

	try {
		const { rows } = await pool.query<{ page_count: number | null; extraction_metadata: unknown | null }>(
			`SELECT page_count, extraction_metadata
			   FROM documents
			  WHERE id = $1
			  LIMIT 1`,
			[sanitizeText(documentId)]
		);
		const row = rows?.[0];
		const pageCount = typeof row?.page_count === "number" && Number.isFinite(row.page_count) ? row.page_count : 0;

		// If extraction_metadata already contains page image URLs (e.g. object storage), prefer them.
		const metaObj = row?.extraction_metadata && typeof row.extraction_metadata === "object" ? (row.extraction_metadata as any) : null;
		const metaListCandidates: unknown[] = [
			metaObj?.page_image_uris,
			metaObj?.page_image_urls,
			metaObj?.page_images,
			metaObj?.rendered_page_uris,
			metaObj?.rendered_page_urls,
			metaObj?.rendered_pages_urls,
			metaObj?.rendered_pages_uris,
		];

		const prefixCandidates: unknown[] = [
			metaObj?.rendered_pages_url_prefix,
			metaObj?.rendered_pages_uri_prefix,
			metaObj?.page_images_url_prefix,
			metaObj?.page_images_uri_prefix,
			metaObj?.page_image_url_prefix,
		];

		const shouldSignR2KeysForRemoteVision = (() => {
			const visionBase = (env.VISION_BASE_URL || env.VISION_WORKER_URL || "").trim();
			const remoteVision = visionBase.startsWith("https://");
			const r2Bucket = (env.R2_BUCKET ?? "").trim();
			return remoteVision && r2Bucket.length > 0;
		})();

		const normalizeLegacyMetaUri = async (raw: string): Promise<string> => {
			const v = raw.trim();
			if (!v) return "";
			if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/uploads/")) return v;
			// Avoid attempting to sign obvious local filesystem paths.
			if (v.startsWith("/")) return v;
			if (!shouldSignR2KeysForRemoteVision) return v;
			const bucket = (env.R2_BUCKET ?? "").trim();
			if (!bucket) return v;
			try {
				const key = v.replace(/^\/+/, "");
				return await getR2ObjectUrl({ bucket, key, env });
			} catch {
				return v;
			}
		};

		const legacyCandidateCounts = { list_urls: 0, prefix: 0 };
		for (const cand of metaListCandidates) {
			if (!Array.isArray(cand)) continue;
			legacyCandidateCounts.list_urls += cand.filter((u) => typeof u === "string" && u.trim().length > 0).length;
		}
		for (const cand of prefixCandidates) {
			if (typeof cand !== "string") continue;
			const prefix = cand.trim();
			if (prefix) legacyCandidateCounts.prefix += 1;
		}

		// Preferred Render-safe location: R2-backed rendered pages.
		// When present, always prefer it over any legacy URL lists/prefixes.
		const renderedR2 =
			metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === "object" ? (metaObj.rendered_pages_r2 as any) : null;
		if (renderedR2) {
			const bucket = typeof renderedR2.bucket === "string" ? renderedR2.bucket.trim() : null;
			let prefix = typeof renderedR2.prefix === "string" ? renderedR2.prefix.trim().replace(/\/$/, "") : "";
			// Cleanup guard: older workers accidentally wrote /pages as the prefix.
			// Treat rendered_pages/ as canonical and auto-upgrade the prefix for reads.
			if (prefix.endsWith("/pages") && !prefix.endsWith("/rendered_pages")) {
				const upgraded = prefix.replace(/\/pages$/, "/rendered_pages");
				logger.warn(
					JSON.stringify({
						event: "RENDERED_PAGES_R2_PREFIX_CANONICALIZED",
						document_id: documentId,
						from: prefix,
						to: upgraded,
					})
				);
				prefix = upgraded;
			}
			const formatRaw = typeof renderedR2.format === "string" ? renderedR2.format.trim() : "";
			const format = formatRaw && !formatRaw.includes("/") ? formatRaw : "page_%04d.png";
			const formatFilename = (pageIndex: number) => {
				const idx = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
				const m = format.match(/%0(\d+)d/);
				if (m) {
					const width = Number.parseInt(m[1], 10);
					const padded = String(idx).padStart(Number.isFinite(width) ? Math.max(1, width) : 4, "0");
					return format.replace(m[0], padded);
				}
				if (format.includes("%d")) return format.replace("%d", String(idx));
				return `page_${String(idx).padStart(4, "0")}.png`;
			};

			const metaRenderedCount =
				typeof metaObj?.rendered_pages_count === "number" && Number.isFinite(metaObj.rendered_pages_count)
					? metaObj.rendered_pages_count
					: 0;
			const metaRenderedSoFar =
				typeof metaObj?.rendered_pages_rendered === "number" && Number.isFinite(metaObj.rendered_pages_rendered)
					? metaObj.rendered_pages_rendered
					: null;
			if (metaRenderedCount > 0 && metaRenderedSoFar != null && metaRenderedSoFar < metaRenderedCount) {
				logger.log(
					JSON.stringify({
						event: "RENDERED_PAGES_R2_NOT_READY",
						document_id: documentId,
						rendered_pages_count: metaRenderedCount,
						rendered_pages_rendered: metaRenderedSoFar,
						reason: "render_incomplete",
					})
				);

				// R2-aware backfill: if the last expected page exists, treat as ready and patch metadata.
				if (prefix) {
					const lastIndex = Math.max(0, metaRenderedCount - 1);
					const lastKey = `${prefix}/${formatFilename(lastIndex)}`;
					try {
						const exists = await r2ObjectExists({ bucket, key: lastKey, env: options?.env });
						if (exists) {
							logger.log(
								JSON.stringify({
									event: "RENDERED_PAGES_R2_PROBE_OVERRIDE",
									document_id: documentId,
									key_checked: lastKey,
									rendered_pages_count: metaRenderedCount,
									rendered_pages_rendered_previous: metaRenderedSoFar,
								})
							);
							try {
								await pool.query(
									"UPDATE documents SET extraction_metadata = COALESCE(extraction_metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1",
									[
										sanitizeText(documentId),
										JSON.stringify({
											rendered_pages_rendered: metaRenderedCount,
											rendered_pages_count: metaRenderedCount,
										}),
									]
								);
							} catch (err) {
								logger.warn(
									JSON.stringify({
										event: "RENDERED_PAGES_R2_BACKFILL_FAILED",
										document_id: documentId,
										error: err instanceof Error ? err.message : String(err),
									})
								);
							}
						} else {
							return [];
						}
					} catch (err) {
						logger.warn(
							JSON.stringify({
								event: "RENDERED_PAGES_R2_PROBE_FAILED",
								document_id: documentId,
								key_checked: lastKey,
								error: err instanceof Error ? err.message : String(err),
							})
						);
						return [];
					}
				} else {
					return [];
				}
			}
			const effectiveCount = pageCount && pageCount > 0 ? pageCount : metaRenderedCount;
			if (prefix && effectiveCount && effectiveCount > 0) {
				try {
					if (legacyCandidateCounts.list_urls > 0 || legacyCandidateCounts.prefix > 0) {
						logger.warn(
							JSON.stringify({
								event: "RENDERED_PAGES_R2_PREFERRED_OVER_LEGACY",
								document_id: documentId,
								legacy_candidate_counts: legacyCandidateCounts,
							})
						);
					}

					const exampleKey0 = `${prefix}/${formatFilename(0)}`;
					const exampleKey10 = `${prefix}/${formatFilename(10)}`;
					logger.log(
						JSON.stringify({
							event: "RENDERED_PAGES_R2_RESOLVE",
							document_id: documentId,
							bucket: bucket,
							prefix,
							format,
							page_count: effectiveCount,
							example_keys: { page_0000: exampleKey0, page_0010: exampleKey10 },
						})
					);

					const urls: string[] = [];
					for (let i = 0; i < effectiveCount; i += 1) {
						const key = `${prefix}/${formatFilename(i)}`;
						urls.push(await getR2ObjectUrl({ bucket, key, env: options?.env }));
					}
					logger.log(
						JSON.stringify({
							event: "PAGE_IMAGE_URIS_FROM_RENDERED_PAGES_R2",
							document_id: documentId,
							count: urls.length,
							page_count: effectiveCount,
						})
					);
					return urls;
				} catch (err) {
					logger.warn(
						`[visual_extraction] rendered_pages_r2 url generation failed doc=${documentId}: ${err instanceof Error ? err.message : String(err)}`
					);
					// fall through to legacy metadata and/or filesystem discovery
				}
			}
		}

		for (const cand of metaListCandidates) {
			if (!Array.isArray(cand)) continue;
			const raw = cand.filter((u) => typeof u === "string" && u.trim().length > 0).map((u) => String(u));
			const urls = shouldSignR2KeysForRemoteVision
				? (await Promise.all(raw.map((u) => normalizeLegacyMetaUri(u)))).filter((u) => typeof u === "string" && u.trim().length > 0)
				: raw.map((u) => u.trim());
			if (urls.length > 0) {
				logger.log(
					JSON.stringify({
						event: "PAGE_IMAGE_URIS_FROM_METADATA",
						document_id: documentId,
						count: urls.length,
						signed_r2_keys: shouldSignR2KeysForRemoteVision,
					})
				);
				return urls;
			}
		}
		for (const cand of prefixCandidates) {
			if (typeof cand !== "string") continue;
			const prefix = cand.trim().replace(/\/$/, "");
			if (!prefix || !(prefix.startsWith("http://") || prefix.startsWith("https://"))) continue;
			if (!pageCount || pageCount <= 0) continue;
			const urls = Array.from({ length: pageCount }, (_, i) => `${prefix}/page_${String(i).padStart(3, "0")}.png`);
			logger.log(
				JSON.stringify({
					event: "PAGE_IMAGE_URIS_FROM_METADATA_PREFIX",
					document_id: documentId,
					count: urls.length,
					page_count: pageCount,
				})
			);
			return urls;
		}

		const dirs = candidateArtifactDirs({ documentId, meta: row?.extraction_metadata, env: options?.env });
		const envNode = (options?.env?.NODE_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
		const r2BucketConfigured = ((options?.env?.R2_BUCKET ?? process.env.R2_BUCKET ?? "") as string).trim().length > 0;
		if (envNode === "production" && r2BucketConfigured) {
			logger.log(
				JSON.stringify({
					event: "NO_PAGE_IMAGES_AVAILABLE",
					document_id: documentId,
					reason: "rendered_pages_missing_prod",
					searched_dirs: [],
				})
			);
			return [];
		}
		for (const dir of dirs) {
			if (!(await dirExists(fsImpl, dir))) continue;
			let files: string[] = [];
			try {
				files = await fsImpl.readdir(dir);
			} catch {
				continue;
			}

			const hasZero = files.some((f) => parsePageIndexFromFilename(f) === 0);
			const byIndex = new Map<number, string[]>();
			for (const f of files) {
				const parsed = parsePageIndexFromFilename(f);
				if (parsed === null) continue;
				const pageIndex = hasZero ? parsed : parsed - 1;
				if (pageIndex < 0) continue;
				if (pageCount && pageCount > 0 && pageIndex >= pageCount) continue;
				const full = path.join(dir, f);
				const list = byIndex.get(pageIndex) ?? [];
				list.push(full);
				byIndex.set(pageIndex, list);
			}

			const inferredPageCount =
				pageCount && pageCount > 0
					? pageCount
					: byIndex.size > 0
						? Math.max(...Array.from(byIndex.keys())) + 1
						: 0;

			const ordered: string[] = [];
			for (let i = 0; i < inferredPageCount; i += 1) {
				const cands = byIndex.get(i);
				if (!cands || cands.length === 0) continue;
				ordered.push(pickBestPerPage(cands));
			}

			if (ordered.length > 0) {
				// If the document row never had page_count, infer it from rendered pages so downstream
				// extraction (and UI) can behave deterministically.
				if ((!pageCount || pageCount <= 0) && inferredPageCount > 0) {
					try {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[sanitizeText(documentId), inferredPageCount]
						);
						logger.log(
							JSON.stringify({
								event: "PAGE_COUNT_INFERRED_FROM_RENDERED_PAGES",
								document_id: documentId,
								page_count: inferredPageCount,
								dir,
							})
						);
					} catch {
						// ignore
					}
				}
				return ordered;
			}
		}

		if (!pageCount || pageCount <= 0) {
			logger.log(
				JSON.stringify({
					event: "NO_PAGE_IMAGES_AVAILABLE",
					document_id: documentId,
					reason: "page_count_missing_and_no_images_found",
					searched_dirs: dirs,
				})
			);
			return [];
		}

		logger.log(
			JSON.stringify({
				event: "NO_PAGE_IMAGES_AVAILABLE",
				document_id: documentId,
				reason: "no_matching_files",
				searched_dirs: dirs,
				page_count: pageCount,
			})
		);
		return [];
	} catch (err) {
		logger.warn(
			`[visual_extraction] resolvePageImageUris failed doc=${documentId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return [];
	}
}

export async function backfillVisualAssetImageUris(params: {
	pool: Pool;
	documentId: string;
	pageImageUris: string[];
	env?: NodeJS.ProcessEnv;
}): Promise<{ updated: number }> {
	const env = params.env ?? process.env;
	let updated = 0;

	for (let i = 0; i < params.pageImageUris.length; i += 1) {
		const normalized = normalizeImageUriForDb(params.pageImageUris[i], env);
		if (!normalized) continue;
		try {
			const res = await params.pool.query<{ rowCount?: number }>(
				`UPDATE visual_assets
					 SET image_uri = $3
				 WHERE document_id = $1
				   AND page_index = $2
				   AND (image_uri IS NULL OR image_uri = '')`,
				[sanitizeText(params.documentId), i, normalized]
			);
			updated += res.rowCount ?? 0;
		} catch (err) {
			console.warn(
				`[visual_extraction] backfill image_uri failed doc=${params.documentId} page=${i}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	return { updated };
}

export async function hasTable(pool: Pool, table: string): Promise<boolean> {
	try {
		const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
		return rows?.[0]?.oid !== null;
	} catch {
		return false;
	}
}


