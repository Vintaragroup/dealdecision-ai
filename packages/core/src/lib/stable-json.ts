type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value != null &&
		typeof value === "object" &&
		(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}

function normalize(value: unknown): JsonValue {
	if (value === null) return null;
	const t = typeof value;
	if (t === "boolean") return value;
	if (t === "number") return Number.isFinite(value as number) ? (value as number) : String(value) as any;
	if (t === "string") return value;

	if (Array.isArray(value)) return value.map((v) => normalize(v));

	if (value instanceof Date) return value.toISOString();

	if (value instanceof Set) return Array.from(value).map((v) => normalize(v));
	if (value instanceof Map) {
		return Array.from(value.entries())
			.map(([k, v]) => [String(k), normalize(v)] as any)
			.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	}

	if (isPlainObject(value)) {
		const out: Record<string, JsonValue> = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = normalize((value as any)[key]);
		}
		return out;
	}

	// Fall back for non-JSON-ish values (e.g. BigInt, class instances)
	try {
		return String(value) as any;
	} catch {
		return "[Unstringifiable]" as any;
	}
}

export function stableJsonStringify(value: unknown): string {
	return JSON.stringify(normalize(value));
}
