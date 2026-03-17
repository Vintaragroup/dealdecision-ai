/**
 * Vision service verification helpers.
 *
 * Extracted from index.ts so extract_visuals and other processors can import
 * without depending on the monolithic index module.
 */

export type VisionServiceVerification = {
	ok: boolean;
	reason?: string;
	health?: { status: number; body_ok: boolean; duration_ms: number };
	openapi?: { status: number; has_extract_visuals: boolean; duration_ms: number };
};

export async function fetchWithTimeout(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
	const timeoutMs =
		typeof init.timeoutMs === "number" && Number.isFinite(init.timeoutMs)
			? Math.max(100, init.timeoutMs)
			: 5000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const { timeoutMs: _ignored, ...rest } = init as any;
		return await fetch(url, { ...rest, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export async function verifyVisionServiceForJob(
	baseUrl: string
): Promise<VisionServiceVerification> {
	const base = String(baseUrl || "")
		.trim()
		.replace(/\/$/, "");
	if (!base) return { ok: false, reason: "missing_vision_base_url" };

	const healthUrl = `${base}/health`;
	const openapiUrl = `${base}/openapi.json`;

	try {
		const healthStarted = Date.now();
		const healthRes = await fetchWithTimeout(healthUrl, {
			method: "GET",
			timeoutMs: 5000,
		});
		const healthBodyText = await healthRes.text().catch(() => "");
		let bodyOk = false;
		try {
			const parsed = JSON.parse(healthBodyText || "{}") as any;
			bodyOk = parsed?.status === "ok";
		} catch {
			bodyOk = false;
		}
		const health = {
			status: healthRes.status,
			body_ok: bodyOk,
			duration_ms: Date.now() - healthStarted,
		};
		if (!healthRes.ok || !bodyOk) {
			return { ok: false, reason: "vision_health_check_failed", health };
		}

		const openapiStarted = Date.now();
		const openapiRes = await fetchWithTimeout(openapiUrl, {
			method: "GET",
			timeoutMs: 5000,
		});
		const openapiText = await openapiRes.text().catch(() => "");
		let hasExtract = false;
		try {
			const spec = JSON.parse(openapiText || "{}") as any;
			hasExtract =
				Boolean(spec?.paths?.["/extract-visuals"]?.post) ||
				Boolean(spec?.paths?.["/extract_visuals"]?.post);
		} catch {
			hasExtract = false;
		}
		const openapi = {
			status: openapiRes.status,
			has_extract_visuals: hasExtract,
			duration_ms: Date.now() - openapiStarted,
		};
		if (!openapiRes.ok || !hasExtract) {
			return {
				ok: false,
				reason: "vision_openapi_check_failed",
				health,
				openapi,
			};
		}

		return { ok: true, health, openapi };
	} catch (err) {
		return {
			ok: false,
			reason: err instanceof Error ? err.message : "vision_check_error",
		};
	}
}
