// visual-extraction/_shared.ts
// Cross-cutting private helpers used by 2+ sub-modules.
// Verbatim extraction from visual-extraction.ts.

import type { VisionBBox } from "./types";
import path from "path";

const SEGMENT_KEYS = [
	"overview",
	"problem",
	"solution",
	"product",
	"market",
	"traction",
	"business_model",
	"competition",
	"team",
	"distribution",
	"raise_terms",
	"exit",
	"risks",
	"financials",
	"unknown",
] as const;

type SegmentKey = (typeof SEGMENT_KEYS)[number];

function coerceSegmentKey(value: unknown): SegmentKey | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return (SEGMENT_KEYS as readonly string[]).includes(trimmed) ? (trimmed as SegmentKey) : null;
}

function mapSlideTypeToSegmentKey(slideTypeRaw: unknown): SegmentKey | null {
	const s = typeof slideTypeRaw === "string" ? slideTypeRaw.trim().toLowerCase() : "";
	if (!s) return null;
	// slide_understanding_v1 types -> platform segment keys
	if (s === "problem") return "problem";
	if (s === "solution") return "solution";
	if (s === "product") return "product";
	if (s === "traction") return "traction";
	if (s === "market") return "market";
	if (s === "business_model") return "business_model";
	if (s === "competition") return "competition";
	if (s === "team") return "team";
	if (s === "financials") return "financials";
	if (s === "raise_terms" || s === "use_of_funds") return "raise_terms";
	if (s === "risks") return "risks";
	if (s === "go_to_market") return "distribution";
	// Unknown/other -> no mapping
	return null;
}

function coerceJsonObject(value: unknown): Record<string, unknown> {
	if (!value) return {};
	if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		} catch {
			// ignore
		}
	}
	return {};
}

function coerceJsonArray<T = unknown>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed as T[];
		} catch {
			// ignore
		}
	}
	return [];
}

function coerceBBox(value: unknown): VisionBBox {
	const obj = coerceJsonObject(value);
	const x = typeof obj.x === "number" ? obj.x : Number(obj.x);
	const y = typeof obj.y === "number" ? obj.y : Number(obj.y);
	const w = typeof obj.w === "number" ? obj.w : Number(obj.w);
	const h = typeof obj.h === "number" ? obj.h : Number(obj.h);

	return {
		x: Number.isFinite(x) ? x : 0,
		y: Number.isFinite(y) ? y : 0,
		w: Number.isFinite(w) ? w : 1,
		h: Number.isFinite(h) ? h : 1,
	};
}

function normalizeImageUriForApi(imageUri: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
	if (!imageUri) return null;
	const trimmed = String(imageUri).trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
	if (trimmed.startsWith("/uploads/")) return trimmed;

	// Best-effort: map absolute file paths under UPLOAD_DIR to an API-relative URL under /uploads.
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : null;
	if (uploadDir && trimmed.startsWith("/")) {
		try {
			const rel = path.relative(uploadDir, trimmed);
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return `/uploads/${rel.split(path.sep).join("/")}`;
			}
		} catch {
			// fall through
		}
	}

	// Anything else (e.g. /tmp/*) is not web-served.
	return null;
}

function stripUrlQueryAndHash(input: string): string {
	const s = String(input ?? "").trim();
	if (!s) return "";
	if (!(s.startsWith("http://") || s.startsWith("https://"))) {
		return s.split("?")[0]?.split("#")[0] ?? s;
	}
	try {
		const u = new URL(s);
		u.search = "";
		u.hash = "";
		return u.toString();
	} catch {
		return s.split("?")[0]?.split("#")[0] ?? s;
	}
}

function tryExtractR2KeyFromUrl(input: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const raw = String(input ?? "").trim();
	if (!(raw.startsWith("http://") || raw.startsWith("https://"))) return null;

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}

	// Public base URL (CDN / public bucket) case.
	const publicBase = typeof env.R2_PUBLIC_BASE_URL === "string" ? env.R2_PUBLIC_BASE_URL.trim().replace(/\/$/, "") : "";
	if (publicBase) {
		try {
			const base = new URL(publicBase);
			if (parsed.origin === base.origin && parsed.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")) {
				const prefix = base.pathname.replace(/\/$/, "") + "/";
				const remainder = parsed.pathname.slice(prefix.length);
				const key = remainder
					.split("/")
					.filter(Boolean)
					.map((seg) => {
						try {
							return decodeURIComponent(seg);
						} catch {
							return seg;
						}
					})
					.join("/");
				return key || null;
			}
		} catch {
			// ignore
		}
	}

	// Signed URL / endpoint (path-style: /<bucket>/<key>) case.
	// Canonical env: R2_ENDPOINT. Back-compat: R2_S3_ENDPOINT.
	const endpointRaw = (() => {
		const v1 = typeof env.R2_ENDPOINT === "string" ? env.R2_ENDPOINT.trim() : "";
		if (v1) return v1;
		return typeof env.R2_S3_ENDPOINT === "string" ? env.R2_S3_ENDPOINT.trim() : "";
	})();
	const bucket = typeof env.R2_BUCKET === "string" ? env.R2_BUCKET.trim() : "";
	if (!endpointRaw || !bucket) return null;

	try {
		const endpoint = new URL(endpointRaw);
		if (parsed.origin !== endpoint.origin) return null;

		const endpointPath = endpoint.pathname.replace(/\/$/, "");
		let pathRemainder = parsed.pathname;
		if (endpointPath && endpointPath !== "/") {
			const prefix = endpointPath + "/";
			if (!pathRemainder.startsWith(prefix)) return null;
			pathRemainder = pathRemainder.slice(prefix.length);
		} else {
			pathRemainder = pathRemainder.replace(/^\//, "");
		}

		const parts = pathRemainder.split("/").filter(Boolean);
		if (parts.length < 2) return null;
		if (parts[0] !== bucket) return null;
		const key = parts
			.slice(1)
			.map((seg) => {
				try {
					return decodeURIComponent(seg);
				} catch {
					return seg;
				}
			})
			.join("/");
		return key || null;
	} catch {
		return null;
	}
}

function normalizeImageUriForDb(imageUri: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
	if (!imageUri) return null;
	const trimmed = String(imageUri).trim();
	if (!trimmed) return null;

	// Already a key (preferred storage format).
	if (!trimmed.startsWith("/") && !(trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
		return trimmed;
	}

	// Preserve /uploads URLs, but never persist query strings.
	if (trimmed.startsWith("/uploads/")) return stripUrlQueryAndHash(trimmed) || null;

	// Best-effort: map absolute file paths under UPLOAD_DIR to an API-relative URL under /uploads.
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : null;
	if (uploadDir && trimmed.startsWith("/")) {
		try {
			const rel = path.relative(uploadDir, trimmed);
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return `/uploads/${rel.split(path.sep).join("/")}`;
			}
		} catch {
			// fall through
		}
	}

	// For HTTP(S): prefer extracting the R2 object key; otherwise strip query so we never persist signed URLs.
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return tryExtractR2KeyFromUrl(trimmed, env) ?? (stripUrlQueryAndHash(trimmed) || null);
	}

	return null;
}

function parseBool(input: string | undefined | null): boolean {
	if (!input) return false;
	return ["1", "true", "yes", "on"].includes(input.trim().toLowerCase());
}

function parseIntWithDefault(input: string | undefined, fallback: number): number {
	const v = Number.parseInt(String(input ?? ""), 10);
	return Number.isFinite(v) ? v : fallback;
}

function classifySegmentKeyFromText(textRaw: string, defaultKey: SegmentKey = "unknown"): SegmentKey {
	const text = String(textRaw || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return defaultKey;

	// API-aligned keyword sets (keep in sync with apps/api classifySegment headingSets).
	const keywordSets: Record<SegmentKey, string[]> = {
		overview: ["overview", "summary", "executive summary"],
		problem: ["problem", "pain", "challenge", "issue", "gap", "why this matters"],
		solution: ["solution", "approach", "value proposition", "why us"],
		product: ["product", "products", "technology", "features", "feature", "demo", "roadmap", "how it works"],
		market: ["market", "tam", "sam", "som", "opportunity", "segment", "sizing", "cagr"],
		traction: [
			"traction",
			"growth",
			"users",
			"customers",
			"mrr",
			"arr",
			"revenue",
			"retention",
			"pipeline",
			"gmv",
			"kpi",
			"conversion",
			"demo-to-close",
			"demo to close",
			"lift",
		],
		business_model: [
			"business model",
			"pricing",
			"revenue model",
			"unit economics",
			"how we make money",
			"saas",
			"platform",
			"add-ons",
			"addons",
			"subscription",
		],
		distribution: [
			"distribution",
			"go-to-market",
			"go to market",
			"gtm",
			"channels",
			"sales",
			"partnerships",
			"marketing",
			"reseller",
			"partners",
			"channel",
		],
		team: ["team", "founder", "ceo", "cto", "cfo", "bio", "leadership", "advisors", "founders", "meet our team"],
		competition: ["competition", "competitor", "alternative", "compare", "landscape", "moat"],
		risks: ["risk", "challenge", "threat", "mitigation", "compliance", "regulation", "limitation"],
		financials: [
			"financial",
			"financial strategy",
			"profit",
			"loss",
			"p&l",
			"balance",
			"cash",
			"projection",
			"forecast",
			"projections",
			"ebitda",
			"budget",
			"expenses",
			"gross margin",
			"revenue",
			"margin",
			"unit economics",
		],
		raise_terms: ["raise", "funding", "round", "terms", "cap table", "valuation", "use of funds", "investment"],
		exit: ["exit", "exit strategy", "acquisition", "m&a", "strategic options", "acquirer", "acquirers", "strategic buyers"],
		unknown: [],
	};

	const weights: Record<SegmentKey, number> = {
		overview: 1,
		problem: 3,
		solution: 3,
		product: 3,
		market: 3,
		traction: 3,
		business_model: 2,
		distribution: 2,
		team: 2,
		competition: 2,
		risks: 2,
		financials: 3,
		raise_terms: 3,
		exit: 2,
		unknown: 0,
	};

	const scoreByKey = new Map<SegmentKey, number>();
	for (const [key, phrases] of Object.entries(keywordSets) as Array<[SegmentKey, string[]]>) {
		if (key === "unknown") continue;
		let score = 0;
		for (const phrase of phrases) {
			if (!phrase) continue;
			if (text.includes(phrase.toLowerCase())) score += weights[key];
		}
		if (score > 0) scoreByKey.set(key, score);
	}

	let best: SegmentKey = defaultKey;
	let bestScore = 0;
	let secondScore = 0;
	for (const [k, s] of scoreByKey.entries()) {
		if (s > bestScore) {
			secondScore = bestScore;
			bestScore = s;
			best = k;
		} else if (s > secondScore) {
			secondScore = s;
		}
	}

	// Confidence gating: keep deterministic, but avoid over-assigning from weak signal.
	const MIN_SCORE = 2;
	const MIN_MARGIN = 1;
	if (bestScore < MIN_SCORE) return defaultKey;
	if (secondScore > 0 && bestScore < secondScore + MIN_MARGIN) return defaultKey;
	return best;
}


export {
    SEGMENT_KEYS,
    coerceSegmentKey,
    mapSlideTypeToSegmentKey,
    coerceJsonObject,
    coerceJsonArray,
    coerceBBox,
    normalizeImageUriForDb,
    parseBool,
    parseIntWithDefault,
    classifySegmentKeyFromText,
};
export type { SegmentKey };
