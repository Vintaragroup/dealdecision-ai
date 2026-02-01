export function normalizeDealName(name: string): string {
  const lower = (name ?? "").toLowerCase().trim();
  if (!lower) return "";

  // Basic corporate suffix stripping and punctuation normalization.
  let s = lower.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\b(inc|incorporated|llc|ltd|corp|co|company|holdings?)\b/g, " ");

  // Common OCR-ish confusion in this dataset: AL vs AI.
  s = s.replace(/\bal\b/g, "ai");

  // Drop trailing version tokens (e.g., "v2", "2", "II").
  s = s.replace(/\b(v\s*)?(\d+|i{2,4}|vi{0,3}|ix|x)\b$/g, " ");

  s = s.replace(/\s+/g, " ").trim();
  return s;
}
