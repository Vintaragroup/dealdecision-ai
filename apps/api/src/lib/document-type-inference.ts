import type { Document } from "@dealdecision/contracts";

export function inferDocumentTypeFromName(input: {
  title?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
}): Document["type"] {
  const combined = [input.title, input.fileName, input.mimeType].filter(Boolean).join(" ").toLowerCase();

  const has = (s: string) => combined.includes(s);
  const endsWith = (s: string) => combined.endsWith(s);

  // Spreadsheets / financial attachments
  if (
    has("application/vnd.ms-excel") ||
    has("application/vnd.openxmlformats-officedocument.spreadsheetml") ||
    has("excel") ||
    has("spreadsheet") ||
    endsWith(".xls") ||
    endsWith(".xlsx") ||
    endsWith(".csv") ||
    has(".xls ") ||
    has(".xlsx ") ||
    has(".csv ")
  ) {
    return "financials";
  }

  // Pitch decks (common for ppt/pptx, sometimes pdf)
  if (
    endsWith(".ppt") ||
    endsWith(".pptx") ||
    has(" pitch deck") ||
    has(" investor deck") ||
    has("executive summary") ||
    has("exec summary") ||
    has(" deck") ||
    has("pd -") ||
    has("pd_")
  ) {
    return "pitch_deck";
  }

  // Product / collateral (one-pagers, cut sheets)
  if (has("cut sheet") || has("cutsheet") || has("one pager") || has("one-pager") || has("wp -") || has("wp_")) {
    return "product";
  }

  // Lightweight keyword fallbacks
  if (has("market") || has("tam") || has("sam") || has("som")) return "market";
  if (has("term sheet") || has("agreement") || has("nda") || has("contract") || has("legal")) return "legal";
  if (has("product") || has("spec") || has("roadmap")) return "product";
  if (has("team") || has("resume") || has("cv") || has("linkedin")) return "team";

  return "other";
}
