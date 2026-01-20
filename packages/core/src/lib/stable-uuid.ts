import { createHash } from "crypto";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Deterministic UUID-like string derived from a seed.
// Not a true RFC4122 v5 UUID, but stable and well-formed for our schema needs.
export function stableUuid(seed: string): string {
  const hex = sha256Hex(seed).slice(0, 32);
  // Inject version/variant bits to look like a v4 UUID.
  const a = hex.slice(0, 8);
  const b = hex.slice(8, 12);
  const c = `4${hex.slice(13, 16)}`;
  const dNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  const d = `${dNibble}${hex.slice(17, 20)}`;
  const e = hex.slice(20, 32);
  return `${a}-${b}-${c}-${d}-${e}`;
}
