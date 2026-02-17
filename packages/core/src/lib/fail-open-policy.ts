export type FailOpenMode = "dev" | "prod_warn" | "prod_block";

export function getFailOpenMode(env: NodeJS.ProcessEnv = process.env): FailOpenMode {
	const raw = typeof env.DDAI_FAIL_OPEN_MODE === "string" ? env.DDAI_FAIL_OPEN_MODE.trim().toLowerCase() : "";
	if (raw === "dev" || raw === "prod_warn" || raw === "prod_block") return raw;
	return env.NODE_ENV === "production" ? "prod_warn" : "dev";
}
