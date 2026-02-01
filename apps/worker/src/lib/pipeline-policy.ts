export type PipelineAutomationMode = "off" | "shadow" | "primary";

function normalizeMode(raw: unknown): PipelineAutomationMode | null {
	if (typeof raw !== "string") return null;
	const v = raw.trim().toLowerCase();
	if (v === "off" || v === "0" || v === "false") return "off";
	if (v === "shadow") return "shadow";
	if (v === "primary") return "primary";
	return null;
}

/**
 * Centralized policy for "set-and-forget" automation defaults.
 *
 * - In non-production: defaults to "shadow" when unset.
 * - In production: defaults to "off" when unset (explicit opt-in required).
 *
 * Set `PIPELINE_AUTOMATION_MODE=shadow|primary` in production to enable.
 */
export function getPipelineAutomationMode(env: NodeJS.ProcessEnv = process.env): PipelineAutomationMode {
	const explicit = normalizeMode(env.PIPELINE_AUTOMATION_MODE);
	if (explicit) return explicit;
	return env.NODE_ENV === "production" ? "off" : "shadow";
}

export function defaultPdfExtractMode(env: NodeJS.ProcessEnv = process.env): "v1" | "v2_shadow" | "v2_primary" {
	const mode = getPipelineAutomationMode(env);
	if (mode === "primary") return "v2_primary";
	if (mode === "shadow") return "v2_shadow";
	return "v1";
}

export function defaultShadowFeatureMode(env: NodeJS.ProcessEnv = process.env): "off" | "shadow" {
	return getPipelineAutomationMode(env) === "off" ? "off" : "shadow";
}

export function defaultVisualExtractionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return getPipelineAutomationMode(env) !== "off";
}
