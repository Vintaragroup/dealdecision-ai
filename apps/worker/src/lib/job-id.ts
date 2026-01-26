export type JobIdPart = string | number | boolean | null | undefined;

function sanitizeJobId(input: string): string {
	// BullMQ/Redis job ids must not contain separators like ':'; keep a conservative safe set.
	// Allowed: [A-Za-z0-9_-]
	const cleaned = input.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return cleaned;
}

export function makeJobId(type: string, parts: JobIdPart[] = []): string {
	const typeSafe = sanitizeJobId(String(type ?? ""));
	const partStrings = parts
		.filter((p) => p != null)
		.map((p) => sanitizeJobId(String(p)))
		.filter((p) => p.length > 0);

	const combined = [typeSafe, ...partStrings].filter((p) => p.length > 0).join("__");
	const finalId = sanitizeJobId(combined);
	return finalId.length > 0 ? finalId : "job";
}
