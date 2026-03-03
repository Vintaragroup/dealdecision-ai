/**
 * build-deal-fact-registry-v1.ts
 *
 * Pure builder: converts Page Registry rows into DealFactV1 entries.
 *
 * Inputs:
 *   - pageRegistryRows: PageRegistryRowV1[] (primary source)
 *
 * Outputs:
 *   - DealFactV1[] (pre-conflict, capped, validated)
 *
 * Hard constraints:
 * - Never hallucinate: only extractive, evidence-backed facts.
 * - Unknown > invention.
 * - Idempotent: same inputs → same fact_ids.
 * - Never throws.
 *
 * Caps (v1):
 *   total facts:        120
 *   traction_metric:     25
 *   product_capability:  20
 *   ai_usage_claim:      10
 *   competitor:          20
 *   key_customer:        20
 *   team_key_role:       20
 */

import type {
  DealFactV1,
  DealFactEvidenceV1,
  DealFactPageRef,
  DealFactConfidence,
} from "@dealdecision/core";
import {
  computeDealFactIdV1,
  capDealFactExcerpt,
  validateDealFact,
} from "@dealdecision/core";
import type { PageRegistryRowV1, NumericClaimV1, PageEntityV1, PageClaimV1 } from "@dealdecision/core";

// ─── Per-type caps ────────────────────────────────────────────────────────────

const CAPS: Record<string, number> = {
  traction_metric:    25,
  product_capability: 20,
  ai_usage_claim:     10,
  competitor:         20,
  key_customer:       20,
  team_key_role:      20,
};
const TOTAL_CAP = 120;

// ─── Evidence mapping ─────────────────────────────────────────────────────────

function rowToSources(row: PageRegistryRowV1): DealFactEvidenceV1[] {
  const sources: DealFactEvidenceV1[] = [];

  // Prefer evidence_ids from page registry (already linked to evidence table)
  for (const eid of (row.evidence_ids ?? []).slice(0, 6)) {
    sources.push({
      evidence_id: eid,
      document_id: row.document_id,
      page_number:  row.page_number,
      excerpt:      row.excerpt ? capDealFactExcerpt(row.excerpt) : undefined,
    });
  }

  // If no evidence_ids, synthesize a single source from page coordinates
  if (sources.length === 0) {
    sources.push({
      evidence_id:  `page:${row.page_id}`,
      document_id:  row.document_id,
      page_number:  row.page_number,
      excerpt:      row.excerpt ? capDealFactExcerpt(row.excerpt) : undefined,
    });
  }

  return sources.slice(0, 6);
}

function rowToPageRef(row: PageRegistryRowV1): DealFactPageRef {
  return {
    document_id: row.document_id,
    page_number:  row.page_number,
    page_type:    row.page_type,
  };
}

// ─── Confidence mapping ───────────────────────────────────────────────────────

function mapConfidence(
  pageConf: "high" | "medium" | "low",
  extraStrong: boolean = false,
): DealFactConfidence {
  if (extraStrong && pageConf === "high") return "high";
  if (pageConf === "high") return "high";
  if (pageConf === "medium") return "medium";
  return "low";
}

// ─── Ask / Raise / Valuation extractor ───────────────────────────────────────

const RAISE_KEYWORDS = /\b(rais|asking|the ask|seek|round size|fundrais|seed round|series [a-d])\b/i;
const VALUATION_KEYWORDS = /\b(valuation|pre-money|post-money|pre money|post money|valued at|valuation cap)\b/i;
const ROUND_STAGE_PATTERN = /\b(pre[-\s]?seed|seed|series\s+[a-d]|series\s+[a-d]\+?|bridge|growth|mezzanine|late[- ]stage)\b/i;

function extractAskFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const facts: DealFactV1[] = [];
  const sources = rowToSources(row);
  const pageRef = rowToPageRef(row);

  // --- Raise amount ---
  for (const claim of row.numeric_claims) {
    if (claim.unit !== "currency") continue;
    const hint = (claim.context + " " + (claim.normalized_label ?? "")).toLowerCase();
    if (!RAISE_KEYWORDS.test(hint) && claim.normalized_label !== "raise_amount") continue;

    const timeframe = extractTimeframe(claim.context);
    const factId = computeDealFactIdV1({
      dealId,
      type: "raise_amount",
      normalizedKeyParts: [
        String(Math.round(claim.value)),
        claim.currency ?? "USD",
        timeframe ?? "",
      ],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "raise_amount",
      label:      "Raise Amount",
      value:      { kind: "money", value: claim.value, currency: claim.currency ?? "USD" },
      timeframe,
      confidence: mapConfidence(row.confidence, claim.normalized_label === "raise_amount"),
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    if (facts.length >= 3) break;
  }

  // --- Valuation ---
  for (const claim of row.numeric_claims) {
    if (claim.unit !== "currency") continue;
    const hint = (claim.context + " " + (claim.normalized_label ?? "")).toLowerCase();
    if (!VALUATION_KEYWORDS.test(hint) && claim.normalized_label !== "valuation") continue;

    const timeframe = extractTimeframe(claim.context);
    const factId = computeDealFactIdV1({
      dealId,
      type: "valuation",
      normalizedKeyParts: [
        String(Math.round(claim.value)),
        claim.currency ?? "USD",
        timeframe ?? "",
      ],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "valuation",
      label:      "Valuation",
      value:      { kind: "money", value: claim.value, currency: claim.currency ?? "USD" },
      timeframe,
      confidence: mapConfidence(row.confidence, claim.normalized_label === "valuation"),
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    if (facts.filter((x) => x.type === "valuation").length >= 3) break;
  }

  // --- Round stage ---
  for (const keyClaim of row.key_claims) {
    const m = ROUND_STAGE_PATTERN.exec(keyClaim.text);
    if (!m) continue;
    const stage = m[0].trim().toLowerCase().replace(/\s+/g, "-");
    const factId = computeDealFactIdV1({ dealId, type: "round_stage", normalizedKeyParts: [stage] });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "round_stage",
      label:      "Round Stage",
      value:      { kind: "string", value: m[0].trim() },
      confidence: mapConfidence(row.confidence),
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    break; // one stage per page
  }

  // Also check entities for round stage if not found in key_claims
  if (!facts.some((f) => f.type === "round_stage")) {
    const stageText = row.excerpt ?? row.key_claims.map((c) => c.text).join(" ");
    const m = ROUND_STAGE_PATTERN.exec(stageText);
    if (m) {
      const stage = m[0].trim();
      const factId = computeDealFactIdV1({ dealId, type: "round_stage", normalizedKeyParts: [stage.toLowerCase()] });
      const f = validateDealFact({
        fact_id:    factId,
        deal_id:    dealId,
        type:       "round_stage",
        label:      "Round Stage",
        value:      { kind: "string", value: stage },
        confidence: "low",
        sources,
        page_refs:  [pageRef],
      });
      if (f) facts.push(f);
    }
  }

  return facts;
}

// ─── Use-of-Funds extractor ───────────────────────────────────────────────────

function extractUseOfFundsFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const items = row.key_claims.map((c) => c.text).filter((t) => t.trim().length > 4);
  if (items.length === 0) return [];

  const factId = computeDealFactIdV1({
    dealId,
    type: "use_of_funds",
    normalizedKeyParts: items.slice(0, 8).map((s) => s.toLowerCase().trim()),
  });

  const f = validateDealFact({
    fact_id:    factId,
    deal_id:    dealId,
    type:       "use_of_funds",
    label:      "Use of Funds",
    value:      { kind: "list", items: items.slice(0, 8) },
    confidence: mapConfidence(row.confidence),
    sources:    rowToSources(row),
    page_refs:  [rowToPageRef(row)],
  });
  return f ? [f] : [];
}

// ─── Traction extractor ───────────────────────────────────────────────────────

const TRACTION_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /\barr\b/i,                       label: "ARR" },
  { pattern: /\bmrr\b/i,                       label: "MRR" },
  { pattern: /\bgrowth\s+rate\b|\bmo[m]?\b/i,  label: "Growth Rate" },
  { pattern: /\bretention\b/i,                  label: "Retention" },
  { pattern: /\bchurn\b/i,                      label: "Churn" },
  { pattern: /\bnps\b|net\s+promoter/i,         label: "NPS" },
  { pattern: /\buser[s]?\b|\bsubscriber[s]?\b/, label: "Users" },
  { pattern: /\bcustomer[s]?\b|\bclient[s]?\b/, label: "Customers" },
  { pattern: /\brevenue\b/i,                    label: "Revenue" },
  { pattern: /\bdownload[s]?\b/i,               label: "Downloads" },
];

function inferTractionLabel(context: string, unit: string): string {
  for (const { pattern, label } of TRACTION_LABELS) {
    if (pattern.test(context)) return label;
  }
  if (unit === "percent") return "Growth";
  if (unit === "multiple") return "Growth Multiple";
  return "Metric";
}

function extractTractionFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const facts: DealFactV1[] = [];
  const sources = rowToSources(row);
  const pageRef = rowToPageRef(row);

  for (const claim of row.numeric_claims) {
    const label = inferTractionLabel(claim.context, claim.unit);
    const timeframe = extractTimeframe(claim.context);

    const factId = computeDealFactIdV1({
      dealId,
      type: "traction_metric",
      normalizedKeyParts: [
        label.toLowerCase(),
        String(Math.round(claim.value)),
        claim.unit,
        timeframe ?? "",
      ],
    });

    const value =
      claim.unit === "currency"
        ? { kind: "money" as const, value: claim.value, currency: claim.currency ?? "USD" }
        : {
            kind: "number" as const,
            value: claim.value,
            unit: claim.unit as "currency" | "percent" | "multiple" | "count" | "unknown",
          };

    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "traction_metric",
      label:      timeframe ? `${label} (${timeframe})` : label,
      value,
      timeframe,
      confidence: mapConfidence(row.confidence),
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    if (facts.length >= CAPS.traction_metric!) break;
  }

  return facts;
}

// ─── Team extractor ───────────────────────────────────────────────────────────

const ROLE_PATTERN = /\b(CEO|CTO|CFO|COO|CPO|CRO|CMO|VP|Founder|Co-Founder|Co-founder|President|Director|Head of)\b/i;
// e.g. "Jane Smith, CEO" or "CEO Jane Smith"
const ROLE_WITH_NAME_LEFT  = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})[,\s]+\b(CEO|CTO|CFO|COO|CPO|CRO|CMO|VP|Founder|Co-Founder|Co-founder|President|Director)\b/;
const ROLE_WITH_NAME_RIGHT = /\b(CEO|CTO|CFO|COO|CPO|CRO|CMO|VP|Founder|Co-Founder|Co-founder|President)\b[,\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/;

function extractTeamFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const facts: DealFactV1[] = [];
  const sources = rowToSources(row);
  const pageRef = rowToPageRef(row);

  // Try to extract role + name pairs from key_claims and entities
  const textLines = [
    ...(row.key_claims ?? []).map((c) => c.text),
    ...(row.entities ?? [])
      .filter((e) => e.kind === "person")
      .map((e) => e.value),
  ];

  for (const line of textLines) {
    let role: string | undefined;
    let name: string | undefined;

    const mLeft = ROLE_WITH_NAME_LEFT.exec(line);
    const mRight = ROLE_WITH_NAME_RIGHT.exec(line);
    if (mLeft) {
      name = mLeft[1].trim();
      role = mLeft[2].trim();
    } else if (mRight) {
      role = mRight[1].trim();
      name = mRight[2].trim();
    } else if (ROLE_PATTERN.test(line)) {
      // Role found but not paired with a name → low confidence
      const mRole = ROLE_PATTERN.exec(line);
      role = mRole![0];
    }

    if (!role) continue;

    const label = name ? `${role}: ${name}` : role;
    const valueStr = name ? `${name} (${role})` : role;
    const factId = computeDealFactIdV1({
      dealId,
      type: "team_key_role",
      normalizedKeyParts: [role.toLowerCase(), (name ?? "").toLowerCase()],
    });

    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "team_key_role",
      label,
      value:      { kind: "string", value: valueStr },
      confidence: name ? mapConfidence(row.confidence) : "low",
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    if (facts.length >= CAPS.team_key_role!) break;
  }

  return facts;
}

// ─── Competitor extractor ─────────────────────────────────────────────────────

function extractCompetitorFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const facts: DealFactV1[] = [];
  const sources = rowToSources(row);
  const pageRef = rowToPageRef(row);

  const competitors = row.entities.filter((e) => e.kind === "competitor");
  for (const entity of competitors) {
    const factId = computeDealFactIdV1({
      dealId,
      type: "competitor",
      normalizedKeyParts: [entity.value.toLowerCase().trim()],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "competitor",
      label:      `Competitor: ${entity.value}`,
      value:      { kind: "entity", kind2: "company", value: entity.value },
      confidence: mapConfidence(row.confidence),
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    if (facts.length >= CAPS.competitor!) break;
  }

  return facts;
}

// ─── Key customer extractor ───────────────────────────────────────────────────

function extractKeyCustomerFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const facts: DealFactV1[] = [];
  const sources = rowToSources(row);
  const pageRef = rowToPageRef(row);

  const customers = row.entities.filter((e) => e.kind === "customer");
  for (const entity of customers) {
    const factId = computeDealFactIdV1({
      dealId,
      type: "key_customer",
      normalizedKeyParts: [entity.value.toLowerCase().trim()],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "key_customer",
      label:      `Key Customer: ${entity.value}`,
      value:      { kind: "entity", kind2: "company", value: entity.value },
      confidence: mapConfidence(row.confidence),
      sources,
      page_refs:  [pageRef],
    });
    if (f) facts.push(f);
    if (facts.length >= CAPS.key_customer!) break;
  }

  return facts;
}

// ─── Product / AI / Business model extractors ────────────────────────────────

const AI_CLAIM_PATTERNS = [
  /\bai[-\s]powered\b/i,
  /\bproprietary\s+(ai|ml|model)\b/i,
  /\bgpt[-\s]?\d?\b|\bllm\b/i,
  /\bmachine\s+learning\b/i,
  /\bneural\s+network\b/i,
  /\bnatural\s+language\s+processing\b/i,
  /\bcomputer\s+vision\b/i,
  /\bai\s+(?:agent|assistant|engine|model|pipeline|backbone)\b/i,
];

const BUSINESS_MODEL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bsaas\b/i,                       label: "SaaS" },
  { pattern: /\busage[-\s]?based\b/i,            label: "Usage-Based" },
  { pattern: /\bmarket\s*place\b/i,              label: "Marketplace" },
  { pattern: /\btransaction\s+fee[s]?\b/i,       label: "Transaction Fees" },
  { pattern: /\bsubscription\b/i,                label: "Subscription" },
  { pattern: /\bprofessional\s+services\b/i,     label: "Professional Services" },
  { pattern: /\bfreemium\b/i,                    label: "Freemium" },
  { pattern: /\blicens(?:ing|e)\b/i,             label: "Licensing" },
];

const TARGET_CUSTOMER_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\benterprise\b/i,                  label: "Enterprise" },
  { pattern: /\bsmb\b|\bsmall\s+(and\s+)?medium\b/i, label: "SMB" },
  { pattern: /\bmid[-\s]?market\b/i,             label: "Mid-Market" },
  { pattern: /\bconsumer\b/i,                    label: "Consumer" },
  { pattern: /\bdev(?:eloper[s]?)?\b/i,          label: "Developers" },
  { pattern: /\bgovernment\b/i,                  label: "Government" },
];

function extractProductFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const facts: DealFactV1[] = [];
  const sources = rowToSources(row);
  const pageRef = rowToPageRef(row);
  const bodyText = [
    ...(row.key_claims ?? []).map((c) => c.text),
    row.excerpt ?? "",
  ].join(" ");

  // AI usage claims
  let aiCount = 0;
  for (const pattern of AI_CLAIM_PATTERNS) {
    const m = pattern.exec(bodyText);
    if (!m) continue;
    const claim = m[0];
    const factId = computeDealFactIdV1({
      dealId,
      type: "ai_usage_claim",
      normalizedKeyParts: [claim.toLowerCase().trim()],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "ai_usage_claim",
      label:      `AI Claim: ${claim}`,
      value:      { kind: "string", value: claim },
      confidence: "medium",
      sources,
      page_refs:  [pageRef],
    });
    if (f) { facts.push(f); aiCount++; }
    if (aiCount >= CAPS.ai_usage_claim!) break;
  }

  // Product capabilities from key_claims
  let capCount = 0;
  for (const keyClaim of row.key_claims) {
    if (keyClaim.text.length < 15) continue;
    const factId = computeDealFactIdV1({
      dealId,
      type: "product_capability",
      normalizedKeyParts: [keyClaim.text.toLowerCase().trim()],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "product_capability",
      label:      "Product Capability",
      value:      { kind: "string", value: keyClaim.text },
      confidence: mapConfidence(row.confidence),
      sources,
      page_refs:  [pageRef],
    });
    if (f) { facts.push(f); capCount++; }
    if (capCount >= CAPS.product_capability!) break;
  }

  // Business model inference
  for (const { pattern, label } of BUSINESS_MODEL_PATTERNS) {
    if (!pattern.test(bodyText)) continue;
    const factId = computeDealFactIdV1({
      dealId,
      type: "business_model",
      normalizedKeyParts: [label.toLowerCase()],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "business_model",
      label:      `Business Model: ${label}`,
      value:      { kind: "string", value: label },
      confidence: mapConfidence(row.confidence),
      sources,
      page_refs:  [pageRef],
    });
    if (f) { facts.push(f); break; } // one best guess per page
  }

  // Target customer
  for (const { pattern, label } of TARGET_CUSTOMER_PATTERNS) {
    if (!pattern.test(bodyText)) continue;
    const factId = computeDealFactIdV1({
      dealId,
      type: "target_customer",
      normalizedKeyParts: [label.toLowerCase()],
    });
    const f = validateDealFact({
      fact_id:    factId,
      deal_id:    dealId,
      type:       "target_customer",
      label:      `Target Customer: ${label}`,
      value:      { kind: "string", value: label },
      confidence: "medium",
      sources,
      page_refs:  [pageRef],
    });
    if (f) { facts.push(f); break; }
  }

  return facts;
}

// ─── GTM extractor ────────────────────────────────────────────────────────────

function extractGtmFacts(row: PageRegistryRowV1, dealId: string): DealFactV1[] {
  const items = row.key_claims.map((c) => c.text).filter((t) => t.length > 8);
  if (items.length === 0) return [];

  const factId = computeDealFactIdV1({
    dealId,
    type: "go_to_market",
    normalizedKeyParts: items.slice(0, 6).map((s) => s.toLowerCase().trim()),
  });
  const f = validateDealFact({
    fact_id:    factId,
    deal_id:    dealId,
    type:       "go_to_market",
    label:      "Go-To-Market",
    value:      { kind: "list", items: items.slice(0, 6) },
    confidence: mapConfidence(row.confidence),
    sources:    rowToSources(row),
    page_refs:  [rowToPageRef(row)],
  });
  return f ? [f] : [];
}

// ─── Timeframe extractor ──────────────────────────────────────────────────────

const TIMEFRAME_PATTERNS: RegExp[] = [
  /\b(FY\s?20\d{2})\b/i,
  /\b(Q[1-4]\s?20\d{2})\b/i,
  /\b(20\d{2})\b/,
  /\b(as\s+of\s+\w+\s+20\d{2})\b/i,
  /\b(YoY|MoM|QoQ)\b/i,
];

function extractTimeframe(text: string): string | undefined {
  for (const p of TIMEFRAME_PATTERNS) {
    const m = p.exec(text);
    if (m) return m[1].trim();
  }
  return undefined;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export interface BuildDealFactRegistryV1Opts {
  dealId: string;
  pageRegistryRows: PageRegistryRowV1[];
}

export interface BuildDealFactRegistryV1Result {
  ok: boolean;
  deal_id: string;
  facts: DealFactV1[];
  pages_processed: number;
  facts_dropped: number;
  error?: string;
}

/**
 * Build DealFactV1 entries from Page Registry rows.
 *
 * - Deterministic: same inputs → same fact_ids.
 * - Idempotent: safe to run multiple times.
 * - Never throws.
 *
 * Prefer page_type-specific extractors; page types drive:
 *   ask          → raise_amount, valuation, round_stage
 *   use_of_funds → use_of_funds
 *   traction     → traction_metric
 *   team         → team_key_role
 *   competition  → competitor
 *   product      → product_capability, ai_usage_claim, business_model, target_customer
 *   gtm          → go_to_market
 *   market       → target_customer (secondary)
 */
export function buildDealFactRegistryV1(
  opts: BuildDealFactRegistryV1Opts,
): BuildDealFactRegistryV1Result {
  try {
    const { dealId, pageRegistryRows } = opts;
    const typeCounts: Record<string, number> = {};
    const allFacts: DealFactV1[] = [];
    let pagesProcessed = 0;

    // Page routing
    const PREFERRED_PAGE_TYPES = new Set([
      "ask", "use_of_funds", "traction", "team",
      "competition", "product", "gtm", "market",
    ]);

    for (const row of pageRegistryRows) {
      if (!PREFERRED_PAGE_TYPES.has(row.page_type)) continue;
      pagesProcessed++;

      let pageFacts: DealFactV1[] = [];

      switch (row.page_type) {
        case "ask":
          pageFacts = extractAskFacts(row, dealId);
          break;
        case "use_of_funds":
          pageFacts = extractUseOfFundsFacts(row, dealId);
          break;
        case "traction":
          pageFacts = extractTractionFacts(row, dealId);
          break;
        case "team":
          pageFacts = extractTeamFacts(row, dealId);
          break;
        case "competition":
          pageFacts = [
            ...extractCompetitorFacts(row, dealId),
            ...extractKeyCustomerFacts(row, dealId),
          ];
          break;
        case "product":
          pageFacts = extractProductFacts(row, dealId);
          break;
        case "gtm":
          pageFacts = extractGtmFacts(row, dealId);
          // Secondary: extract product facts from gtm page too
          pageFacts.push(...extractProductFacts(row, dealId));
          break;
        case "market":
          // Extract target customer from market pages
          pageFacts = extractProductFacts(row, dealId).filter(
            (f) => f.type === "target_customer"
          );
          break;
      }

      // Also try extracting AI claims + business model from ALL preferred pages
      if (!["product", "gtm"].includes(row.page_type)) {
        const extra = extractProductFacts(row, dealId).filter(
          (f) => f.type === "ai_usage_claim" || f.type === "business_model"
        );
        pageFacts.push(...extra);
      }

      allFacts.push(...pageFacts);
    }

    // Dedup by fact_id (keep first occurrence — page order matters)
    const seen = new Set<string>();
    const deduped: DealFactV1[] = [];
    for (const f of allFacts) {
      if (!seen.has(f.fact_id)) {
        seen.add(f.fact_id);
        deduped.push(f);
      }
    }

    // Apply per-type caps
    const capped: DealFactV1[] = [];
    const perTypeCounts: Record<string, number> = {};
    let dropped = 0;

    for (const f of deduped) {
      const cap = CAPS[f.type] ?? TOTAL_CAP;
      const count = perTypeCounts[f.type] ?? 0;
      if (count >= cap) { dropped++; continue; }
      perTypeCounts[f.type] = count + 1;
      capped.push(f);
    }

    // Apply total cap
    const final = capped.slice(0, TOTAL_CAP);
    dropped += Math.max(0, capped.length - TOTAL_CAP);

    return {
      ok:              true,
      deal_id:         dealId,
      facts:           final,
      pages_processed: pagesProcessed,
      facts_dropped:   dropped,
    };
  } catch (err) {
    return {
      ok:              false,
      deal_id:         opts.dealId,
      facts:           [],
      pages_processed: 0,
      facts_dropped:   0,
      error:           String(err),
    };
  }
}
