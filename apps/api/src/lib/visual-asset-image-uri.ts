import * as r2 from "./r2";

function isHttpUrl(s: string): boolean {
	return s.startsWith("http://") || s.startsWith("https://");
}

function stripQueryAndHash(input: string): string {
	const s = input.trim();
	if (!isHttpUrl(s)) return s.split("?")[0]?.split("#")[0] ?? s;
	try {
		const u = new URL(s);
		u.search = "";
		u.hash = "";
		return u.toString();
	} catch {
		return s.split("?")[0]?.split("#")[0] ?? s;
	}
}

function tryExtractR2KeyFromUrl(input: string): string | null {
	const s = input.trim();
	if (!isHttpUrl(s)) return null;

	let cfg: ReturnType<typeof r2.getR2Config> | null = null;
	try {
		cfg = r2.getR2Config();
	} catch {
		cfg = null;
	}
	if (!cfg) return null;

	let u: URL;
	try {
		u = new URL(s);
	} catch {
		return null;
	}

	// Public base URL (CDN) case: key is the remainder after base path.
	if (cfg.publicBaseUrl) {
		try {
			const base = new URL(cfg.publicBaseUrl);
			const basePath = base.pathname.replace(/\/$/, "");
			if (u.origin === base.origin && u.pathname.startsWith(basePath + "/")) {
				const remainder = u.pathname.slice((basePath + "/").length);
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

	// Endpoint path-style case: /<bucket>/<key>
	try {
		const endpoint = new URL(cfg.endpoint);
		if (u.origin !== endpoint.origin) return null;
		const endpointPath = endpoint.pathname.replace(/\/$/, "");
		let remainder = u.pathname;
		if (endpointPath && endpointPath !== "/") {
			const prefix = endpointPath + "/";
			if (!remainder.startsWith(prefix)) return null;
			remainder = remainder.slice(prefix.length);
		} else {
			remainder = remainder.replace(/^\//, "");
		}
		const parts = remainder.split("/").filter(Boolean);
		if (parts.length < 2) return null;
		if (parts[0] !== cfg.bucket) return null;
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

export async function resolveVisualAssetImageUriForApi(stored: string | null): Promise<string | null> {
	if (typeof stored !== "string") return null;
	const s = stored.trim();
	if (!s) return null;

	// Local/static uploads are served directly by the API.
	if (s.startsWith("/uploads/")) return stripQueryAndHash(s);

	// If a caller has an absolute local path (legacy/dev-only), do not attempt to sign it.
	// R2 object keys are expected to be relative (no leading slash).
	if (s.startsWith("/")) return stripQueryAndHash(s);

	// If we have an HTTP URL, try to convert it back into an R2 key so we can issue a fresh signature.
	if (isHttpUrl(s)) {
		const key = tryExtractR2KeyFromUrl(s);
		if (!key) return stripQueryAndHash(s);
		try {
			return r2.getPublicUrlForKey(key) ?? (await r2.getSignedDownloadUrl({ key }));
		} catch {
			// If R2 isn't configured (tests/dev), fall back to the original URL without a signature.
			return stripQueryAndHash(s);
		}
	}

	// Otherwise treat it as a stored R2 key.
	try {
		return r2.getPublicUrlForKey(s) ?? (await r2.getSignedDownloadUrl({ key: s }));
	} catch {
		// If we can't sign (R2 not configured), preserve legacy behavior.
		return s;
	}
}
