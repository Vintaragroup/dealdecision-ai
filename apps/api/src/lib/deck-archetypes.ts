import type { AnalystSegment } from "./analyst-segment";

export type DeckArchetypeKeyV1 =
  | "consumer_apparel_dtc"
  | "enterprise_saas_compliance"
  | "pe_rollup_consolidation"
  | "unknown";

export type DeckArchetypeDiagnosticV1 = {
  kind: "missing_required" | "overrepresentation" | "conflict" | "satisfied_by_synthesis";
  segment?: AnalystSegment;
  message: string;
  details?: Record<string, any>;
};

export type DeckArchetypeExpectedSegmentV1 = {
  segment: AnalystSegment;
  expected_min: number;
  expected_max: number;
  note?: string;
};

export type DeckArchetypeV1 = {
  version: "deck_archetype_v1";
  key: DeckArchetypeKeyV1;
  confidence: number; // 0..1 deterministic heuristic confidence
  scores: Record<Exclude<DeckArchetypeKeyV1, "unknown">, number>;
  segment_counts: Partial<Record<AnalystSegment, number>>;
  keyword_hits: Record<string, number>;
};

export type ArchetypeInferenceInputNode = {
  slide_title?: string | null;
  bullets?: string[] | null;
  bullets_snippet?: string | null;
  segment_key?: AnalystSegment | null;
};

type ArchetypeDefinition = {
  key: Exclude<DeckArchetypeKeyV1, "unknown">;
  required_segments: AnalystSegment[];
  required_any_groups?: AnalystSegment[][]; // at least one segment present from each group
  keywords: Array<{ token: string; weight: number }>;
};

const normalizeWhitespace = (s: string): string => String(s).replace(/\s+/g, " ").trim();

function tokenizeLoose(s: string): string {
  return normalizeWhitespace(String(s))
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeText(node: ArchetypeInferenceInputNode): string {
  const parts: string[] = [];
  if (typeof node.slide_title === "string" && node.slide_title.trim()) parts.push(node.slide_title);
  const bullets = Array.isArray(node.bullets) ? node.bullets : [];
  for (const b of bullets) {
    if (typeof b === "string" && b.trim()) parts.push(b);
  }
  if (typeof node.bullets_snippet === "string" && node.bullets_snippet.trim()) parts.push(node.bullets_snippet);
  return tokenizeLoose(parts.join(" \n "));
}

function countSegments(nodes: ArchetypeInferenceInputNode[]): Partial<Record<AnalystSegment, number>> {
  const out: Partial<Record<AnalystSegment, number>> = {};
  for (const n of nodes) {
    const k = n?.segment_key ?? null;
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function scoreDefinition(def: ArchetypeDefinition, input: { nodes: ArchetypeInferenceInputNode[]; segment_counts: Partial<Record<AnalystSegment, number>> }) {
  const text = input.nodes.map(nodeText).join(" ");

  const keywordHits: Record<string, number> = {};
  let keywordWeighted = 0;
  let keywordPossible = 0;
  for (const kw of def.keywords) {
    keywordPossible += kw.weight;
    const token = tokenizeLoose(kw.token);
    if (!token) continue;

    const hit = text.includes(token);
    if (hit) {
      keywordHits[kw.token] = (keywordHits[kw.token] ?? 0) + 1;
      keywordWeighted += kw.weight;
    }
  }
  const keywordScore = keywordPossible > 0 ? Math.max(0, Math.min(1, keywordWeighted / keywordPossible)) : 0;

  const required = def.required_segments;
  const requiredPresent = required.filter((s) => (input.segment_counts[s] ?? 0) > 0).length;
  const requiredScore = required.length > 0 ? requiredPresent / required.length : 0;

  let groupScore = 1;
  if (Array.isArray(def.required_any_groups) && def.required_any_groups.length > 0) {
    const groupHits = def.required_any_groups.map((g) => g.some((s) => (input.segment_counts[s] ?? 0) > 0));
    const groupPresent = groupHits.filter(Boolean).length;
    groupScore = groupPresent / def.required_any_groups.length;
  }

  // Deterministic heuristic blend: keywords dominate, but structure matters.
  const score = 0.62 * keywordScore + 0.28 * requiredScore + 0.10 * groupScore;

  return { score, keywordHits };
}

const DEFINITIONS: ArchetypeDefinition[] = [
  {
    key: "consumer_apparel_dtc",
    required_segments: ["product", "market", "traction", "business_model"],
    required_any_groups: [["go_to_market", "distribution"]],
    keywords: [
      { token: "apparel", weight: 2 },
      { token: "accessories", weight: 1 },
      { token: "glove", weight: 1 },
      { token: "golf", weight: 1 },
      { token: "dtc", weight: 3 },
      { token: "wholesale", weight: 2 },
      { token: "retail", weight: 1 },
      { token: "shopify", weight: 1 },
      { token: "inventory", weight: 1 },
      { token: "brand", weight: 1 },
    ],
  },
  {
    key: "enterprise_saas_compliance",
    required_segments: ["operations", "product"],
    required_any_groups: [["market", "traction"], ["team", "risks"]],
    keywords: [
      { token: "compliance", weight: 3 },
      { token: "soc 2", weight: 3 },
      { token: "gdpr", weight: 2 },
      { token: "hipaa", weight: 2 },
      { token: "audit", weight: 2 },
      { token: "controls", weight: 2 },
      { token: "policy", weight: 1 },
      { token: "security", weight: 2 },
      { token: "privacy", weight: 1 },
      { token: "regulated", weight: 2 },
      { token: "enterprise", weight: 1 },
      { token: "workflow", weight: 1 },
      { token: "api", weight: 1 },
    ],
  },
  {
    key: "pe_rollup_consolidation",
    required_segments: ["financials", "business_model", "operations"],
    required_any_groups: [["exit", "market"], ["team", "traction"]],
    keywords: [
      { token: "roll up", weight: 3 },
      { token: "roll-up", weight: 3 },
      { token: "consolidation", weight: 3 },
      { token: "acquisition", weight: 3 },
      { token: "acquire", weight: 2 },
      { token: "bolt on", weight: 2 },
      { token: "platform", weight: 1 },
      { token: "ebitda", weight: 3 },
      { token: "multiple", weight: 2 },
      { token: "synergy", weight: 1 },
      { token: "integration", weight: 1 },
      { token: "irr", weight: 2 },
    ],
  },
];

function topSegments(segmentCounts: Partial<Record<AnalystSegment, number>>): Array<{ segment: AnalystSegment; count: number }> {
  return Object.entries(segmentCounts)
    .map(([k, v]) => ({ segment: k as AnalystSegment, count: typeof v === "number" ? v : 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

function isBusinessModelSatisfied(input: {
  segment_counts: Partial<Record<AnalystSegment, number>>;
  structured_summary?: any;
}): { satisfied: boolean; satisfiedBy: "segment" | "synthesis" | null; confidence?: number } {
  const counts = input.segment_counts ?? {};
  if ((counts.business_model ?? 0) >= 1) return { satisfied: true, satisfiedBy: "segment" };

  const structured = input.structured_summary ?? null;
  const bm = structured && typeof structured === "object"
    ? (structured.business_model_summary_v1 ?? structured.business_model_summary)
    : null;
  const conf = (bm && typeof bm.confidence === "number" && Number.isFinite(bm.confidence)) ? bm.confidence : 0;
  const valueOk = typeof bm?.value === "string" && bm.value.trim().length > 0;

  const derived = (bm && bm.derived_from && typeof bm.derived_from === "object") ? bm.derived_from : {};
  const hasAnchors =
    (Array.isArray(derived.product_pages) ? derived.product_pages.length : 0) > 0 ||
    (Array.isArray(derived.gtm_pages) ? derived.gtm_pages.length : 0) > 0 ||
    (Array.isArray(derived.traction_pages) ? derived.traction_pages.length : 0) > 0 ||
    (Array.isArray(derived.market_pages) ? derived.market_pages.length : 0) > 0 ||
    (Array.isArray(derived.distribution_pages) ? derived.distribution_pages.length : 0) > 0;

  if (conf >= 0.7 && valueOk && hasAnchors) {
    return { satisfied: true, satisfiedBy: "synthesis", confidence: conf };
  }

  return { satisfied: false, satisfiedBy: null };
}

export function inferDeckArchetypeV1(nodes: ArchetypeInferenceInputNode[]): {
  deck_archetype: DeckArchetypeV1;
  diagnostics: DeckArchetypeDiagnosticV1[];
};
export function inferDeckArchetypeV1(
  nodes: ArchetypeInferenceInputNode[],
  opts?: { structured_summary?: any }
): {
  deck_archetype: DeckArchetypeV1;
  diagnostics: DeckArchetypeDiagnosticV1[];
};
export function inferDeckArchetypeV1(nodes: ArchetypeInferenceInputNode[], opts?: { structured_summary?: any }): {
  deck_archetype: DeckArchetypeV1;
  diagnostics: DeckArchetypeDiagnosticV1[];
} {
  const safeNodes = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  const segment_counts = countSegments(safeNodes);

  const scores: Record<Exclude<DeckArchetypeKeyV1, "unknown">, number> = {
    consumer_apparel_dtc: 0,
    enterprise_saas_compliance: 0,
    pe_rollup_consolidation: 0,
  };

  const keyword_hits: Record<string, number> = {};
  for (const def of DEFINITIONS) {
    const r = scoreDefinition(def, { nodes: safeNodes, segment_counts });
    scores[def.key] = r.score;
    for (const [k, v] of Object.entries(r.keywordHits)) keyword_hits[k] = (keyword_hits[k] ?? 0) + v;
  }

  const sorted = (Object.entries(scores) as Array<[Exclude<DeckArchetypeKeyV1, "unknown">, number]>).sort((a, b) => b[1] - a[1]);
  const top = sorted[0] ?? ["consumer_apparel_dtc", 0];
  const second = sorted[1] ?? ["enterprise_saas_compliance", 0];

  // Thresholding: if signals are weak, declare unknown.
  const bestKey = top[0];
  const bestScore = top[1];

  const chosenKey: DeckArchetypeKeyV1 = bestScore >= 0.42 ? bestKey : "unknown";
  const confidence = chosenKey === "unknown" ? Math.max(0, Math.min(0.35, bestScore)) : Math.max(0, Math.min(1, bestScore));

  const diagnostics: DeckArchetypeDiagnosticV1[] = [];

  // Missing required structure diagnostics (only when we actually select a concrete archetype).
  if (chosenKey !== "unknown") {
    const def = DEFINITIONS.find((d) => d.key === chosenKey) ?? null;
    if (def) {
      let missingRequired = def.required_segments.filter((s) => (segment_counts[s] ?? 0) <= 0);

      // Satisfaction bridge: allow synthesized, provenance-backed business model to satisfy
      // a missing business_model segment requirement (strict confidence + anchors).
      if (missingRequired.includes("business_model")) {
        const satisfied = isBusinessModelSatisfied({ segment_counts, structured_summary: opts?.structured_summary });
        if (satisfied.satisfied && satisfied.satisfiedBy === "synthesis") {
          missingRequired = missingRequired.filter((s) => s !== "business_model");
          diagnostics.push({
            kind: "satisfied_by_synthesis",
            segment: "business_model",
            message: "business_model requirement satisfied via synthesized business_model_summary_v1",
            details: { confidence: satisfied.confidence ?? null },
          });
        }
      }

      if (missingRequired.length > 0) {
        diagnostics.push({
          kind: "missing_required",
          message: `Missing required segments for ${chosenKey}: ${missingRequired.join(", ")}`,
          details: { archetype: chosenKey, missing_segments: missingRequired, segment_counts },
        });
      }

      if (Array.isArray(def.required_any_groups) && def.required_any_groups.length > 0) {
        for (const group of def.required_any_groups) {
          const ok = group.some((s) => (segment_counts[s] ?? 0) > 0);
          if (!ok) {
            diagnostics.push({
              kind: "missing_required",
              message: `Missing one-of segments for ${chosenKey}: expected one of [${group.join(" | ")}]`,
              details: { archetype: chosenKey, expected_one_of: group, segment_counts },
            });
          }
        }
      }
    }
  }

  // Overrepresentation: one segment dominates the deck.
  const topSegs = topSegments(segment_counts);
  const totalNonUnknown = topSegs.reduce((acc, x) => acc + x.count, 0);
  const topSeg = topSegs[0] ?? null;
  if (topSeg && totalNonUnknown >= 6) {
    const frac = topSeg.count / totalNonUnknown;
    if (frac >= 0.62) {
      diagnostics.push({
        kind: "overrepresentation",
        segment: topSeg.segment,
        message: `Overrepresented segment: ${topSeg.segment} (${Math.round(frac * 100)}% of nodes)` ,
        details: { segment: topSeg.segment, fraction: frac, segment_counts },
      });
    }
  }

  // Conflict: two archetypes are very close (signals overlap).
  if (bestScore >= 0.42 && second[1] >= 0.38 && Math.abs(bestScore - second[1]) <= 0.07) {
    diagnostics.push({
      kind: "conflict",
      message: `Archetype signals conflict: ${bestKey} (${bestScore.toFixed(2)}) vs ${second[0]} (${second[1].toFixed(2)})`,
      details: { best: { key: bestKey, score: bestScore }, second: { key: second[0], score: second[1] }, scores },
    });
  }

  const deck_archetype: DeckArchetypeV1 = {
    version: "deck_archetype_v1",
    key: chosenKey,
    confidence,
    scores,
    segment_counts,
    keyword_hits,
  };

  return { deck_archetype, diagnostics };
}

export function getDeckArchetypeDefinitionV1(key: Exclude<DeckArchetypeKeyV1, "unknown">): ArchetypeDefinition | null {
  return DEFINITIONS.find((d) => d.key === key) ?? null;
}

export function getDeckArchetypeExpectedSegmentsV1(
  key: Exclude<DeckArchetypeKeyV1, "unknown">
): DeckArchetypeExpectedSegmentV1[] {
  // Display-only expectations for dashboard auditing. These ranges are intentionally
  // permissive: they reflect typical deck structure, not enforced rules.
  if (key === "consumer_apparel_dtc") {
    return [
      { segment: "product", expected_min: 1, expected_max: 4 },
      { segment: "market", expected_min: 1, expected_max: 3 },
      { segment: "traction", expected_min: 1, expected_max: 3 },
      { segment: "business_model", expected_min: 1, expected_max: 2 },
      { segment: "go_to_market", expected_min: 1, expected_max: 2 },
      { segment: "distribution", expected_min: 0, expected_max: 2, note: "Wholesale/retail channel slides" },
      { segment: "team", expected_min: 0, expected_max: 2 },
      { segment: "financials", expected_min: 0, expected_max: 2 },
      { segment: "raise_terms", expected_min: 0, expected_max: 1 },
      { segment: "risks", expected_min: 0, expected_max: 1 },
    ];
  }

  if (key === "enterprise_saas_compliance") {
    return [
      { segment: "operations", expected_min: 2, expected_max: 6, note: "Compliance/security controls often dominate" },
      { segment: "product", expected_min: 1, expected_max: 4 },
      { segment: "risks", expected_min: 0, expected_max: 3 },
      { segment: "market", expected_min: 0, expected_max: 2 },
      { segment: "traction", expected_min: 0, expected_max: 2 },
      { segment: "team", expected_min: 0, expected_max: 2 },
      { segment: "financials", expected_min: 0, expected_max: 2 },
      { segment: "raise_terms", expected_min: 0, expected_max: 1 },
    ];
  }

  // pe_rollup_consolidation
  return [
    { segment: "financials", expected_min: 2, expected_max: 6 },
    { segment: "business_model", expected_min: 1, expected_max: 3 },
    { segment: "operations", expected_min: 1, expected_max: 3, note: "Integration + operating playbook" },
    { segment: "market", expected_min: 0, expected_max: 2 },
    { segment: "traction", expected_min: 0, expected_max: 2 },
    { segment: "team", expected_min: 0, expected_max: 2 },
    { segment: "exit", expected_min: 0, expected_max: 2 },
    { segment: "competition", expected_min: 0, expected_max: 2 },
    { segment: "risks", expected_min: 0, expected_max: 2 },
    { segment: "raise_terms", expected_min: 0, expected_max: 1 },
  ];
}
