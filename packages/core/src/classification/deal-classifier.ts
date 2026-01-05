import type {
  DealAssetClass,
  DealClassification,
  DealClassificationResult,
} from "../types/dio";
import type { DealPolicyId } from "./deal-policy-registry";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const toSnakeCase = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

type TextInputs = {
  documents?: any[];
  evidence?: any[];
};

function normalizeTextInputs(input: TextInputs): { text: string; snippets: string[] } {
  const snippets: string[] = [];

  const docs = Array.isArray(input.documents) ? input.documents : [];
  for (const d of docs) {
    const t =
      (typeof d?.full_text === "string" && d.full_text) ||
      (typeof d?.fullText === "string" && d.fullText) ||
      (typeof d?.text === "string" && d.text) ||
      (typeof d?.summary === "string" && d.summary) ||
      (typeof d?.text_summary === "string" && d.text_summary) ||
      (typeof d?.textSummary === "string" && d.textSummary) ||
      "";

    if (t.trim()) snippets.push(t);

    const headings = Array.isArray(d?.headings) ? d.headings : [];
    if (headings.length > 0) snippets.push(headings.join("\n"));

    if (Array.isArray(d?.metrics) && d.metrics.length > 0) {
      const metricLines = d.metrics
        .slice(0, 50)
        .map((m: any) => `${String(m?.key ?? "").trim()}: ${String(m?.value ?? "").trim()}`)
        .filter(Boolean);
      if (metricLines.length > 0) snippets.push(metricLines.join("\n"));
    }
  }

  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  for (const e of evidence) {
    const t = typeof e?.text === "string" ? e.text : (typeof e === "string" ? e : "");
    if (t.trim()) snippets.push(t);
  }

  const text = snippets.join("\n\n");
  return { text, snippets };
}

type SignalRule = {
  id: string;
  re: RegExp;
  weight: number; // 0..1 (aggregate)
  reason: string;
};

function scoreSignals(textLc: string, rules: SignalRule[]): { score: number; signals: string[] } {
  let sum = 0;
  const signals: string[] = [];

  for (const r of rules) {
    if (r.re.test(textLc)) {
      sum += r.weight;
      signals.push(r.reason);
    }
  }

  // Map a modest number of strong signals to high confidence deterministically.
  // 1.0+ cumulative weight saturates to 1.
  const score = clamp01(sum);
  return { score, signals };
}

function mkCandidate(
  asset_class: DealAssetClass,
  deal_structure: string,
  strategy_subtype: string | null,
  confidence: number,
  signals: string[]
): DealClassification {
  return {
    asset_class,
    deal_structure: toSnakeCase(deal_structure) || "unknown",
    strategy_subtype: strategy_subtype ? toSnakeCase(strategy_subtype) : null,
    confidence: clamp01(confidence),
    signals,
  };
}

function routePolicyFromCandidate(c: DealClassification): DealPolicyId {
  if (c.asset_class === "real_estate") return "real_estate_underwriting";
  if (c.asset_class === "fund_vehicle") return "fund_spv";
  if (c.asset_class === "credit") return "credit_memo";

  // Operating company can still be acquisition/startup raise.
  if (c.deal_structure === "acquisition" || c.deal_structure === "asset_purchase") return "acquisition_memo";
  if (c.deal_structure === "safe" || c.deal_structure === "priced_round" || c.deal_structure === "equity_raise") return "startup_raise";

  return "unknown_generic";
}

export function classifyDealV1(input: TextInputs): DealClassificationResult {
  const { text } = normalizeTextInputs(input);
  const textLc = text.toLowerCase();

  const realEstateRules: SignalRule[] = [
    { id: "noi", re: /\bnoi\b|net operating income/, weight: 0.25, reason: "Contains NOI" },
    { id: "dscr", re: /\bdscr\b|debt service coverage/, weight: 0.25, reason: "Contains DSCR" },
    { id: "ltv", re: /\bltv\b|loan[-\s]?to[-\s]?value/, weight: 0.25, reason: "Contains LTV" },
    { id: "cap_rate", re: /cap\s*rate|\bcaprate\b/, weight: 0.2, reason: "Contains cap rate" },
    { id: "lease", re: /\blease\b|tenant|rent roll|occupancy/, weight: 0.15, reason: "Contains lease/tenant/occupancy" },
    { id: "preferred_equity", re: /preferred\s+equity|pref\.?\s+equity/, weight: 0.25, reason: "Mentions preferred equity" },
    { id: "property", re: /\bproperty\b|\breal\s+estate\b|\bfacility\b|\bparcel\b/, weight: 0.15, reason: "Real estate / property language" },
  ];

  const fundRules: SignalRule[] = [
    { id: "lpa", re: /limited\s+partnership\s+agreement|\blpa\b/, weight: 0.35, reason: "Mentions LPA" },
    { id: "gp_lp", re: /\bgp\b|\blp\b|general\s+partner|limited\s+partner/, weight: 0.25, reason: "Mentions GP/LP" },
    { id: "carry", re: /carried\s+interest|\bcarry\b/, weight: 0.25, reason: "Mentions carried interest" },
    { id: "mgmt_fee", re: /management\s+fee|\b1\.5%\b|\b2%\b/, weight: 0.15, reason: "Mentions management fee" },
    { id: "commit", re: /capital\s+commitments?|subscriptions?|subscription\s+documents?/, weight: 0.25, reason: "Mentions commitments/subscriptions" },
    { id: "spv", re: /\bspv\b|special\s+purpose\s+vehicle/, weight: 0.2, reason: "Mentions SPV" },
  ];

  const acquisitionRules: SignalRule[] = [
    { id: "loi", re: /\bloi\b|letter\s+of\s+intent/, weight: 0.3, reason: "Mentions LOI" },
    { id: "purchase_agreement", re: /purchase\s+agreement|asset\s+purchase|stock\s+purchase/, weight: 0.35, reason: "Mentions purchase agreement" },
    { id: "earnout", re: /earn[-\s]?out/, weight: 0.2, reason: "Mentions earnout" },
    { id: "working_capital", re: /working\s+capital\s+peg|working\s+capital\s+adjustment/, weight: 0.2, reason: "Mentions working capital peg" },
    { id: "qoe", re: /\bqoe\b|quality\s+of\s+earnings/, weight: 0.25, reason: "Mentions QoE" },
  ];

  const startupRaiseRules: SignalRule[] = [
    { id: "safe", re: /\bsafe\b|simple\s+agreement\s+for\s+future\s+equity/, weight: 0.4, reason: "Mentions SAFE" },
    { id: "priced_round", re: /priced\s+round|series\s+[ab]|seed\s+round|pre[-\s]?money|post[-\s]?money/, weight: 0.25, reason: "Mentions priced round terms" },
    { id: "vc_terms", re: /valuation\s+cap|discount\s+rate|pro\s*rata/, weight: 0.2, reason: "Mentions common venture terms" },
    { id: "saas_metrics", re: /\barr\b|\bmrr\b|\bcac\b|\bltv\b|churn|ndr|gross\s+margin/, weight: 0.25, reason: "Mentions SaaS metrics" },
  ];

  const creditRules: SignalRule[] = [
    { id: "interest", re: /interest\s+rate|\bapr\b|\bcoupon\b/, weight: 0.25, reason: "Mentions interest/coupon" },
    { id: "collateral", re: /collateral|security\s+interest|lien/, weight: 0.25, reason: "Mentions collateral" },
    { id: "covenants", re: /covenants?|\bdscr\b/, weight: 0.25, reason: "Mentions covenants" },
    { id: "senior_mezz", re: /senior\s+debt|mezzanine|\bmezz\b|secured\s+note/, weight: 0.25, reason: "Mentions senior/mezz/secured" },
    { id: "term_sheet", re: /term\s+sheet/, weight: 0.15, reason: "Mentions term sheet" },
  ];

  const realEstate = scoreSignals(textLc, realEstateRules);
  const fund = scoreSignals(textLc, fundRules);
  const acquisition = scoreSignals(textLc, acquisitionRules);
  const startupRaise = scoreSignals(textLc, startupRaiseRules);
  const credit = scoreSignals(textLc, creditRules);

  const candidates: DealClassification[] = [];

  if (realEstate.score > 0) {
    const structure = /preferred\s+equity|pref\.?\s+equity/.test(textLc) ? "preferred_equity" : "equity_raise";
    candidates.push(
      mkCandidate(
        "real_estate",
        structure,
        structure === "preferred_equity" ? "real_estate_preferred_equity" : "real_estate",
        realEstate.score,
        realEstate.signals
      )
    );
  }

  if (fund.score > 0) {
    const structure = /\bspv\b|special\s+purpose\s+vehicle/.test(textLc) ? "spv" : "fund_vehicle";
    candidates.push(mkCandidate("fund_vehicle", structure, "fund_vehicle", fund.score, fund.signals));
  }

  if (credit.score > 0) {
    const structure = /mezzanine|\bmezz\b/.test(textLc) ? "mezzanine_debt" : /senior\s+debt/.test(textLc) ? "senior_debt" : "credit";
    candidates.push(mkCandidate("credit", structure, "credit", credit.score, credit.signals));
  }

  if (acquisition.score > 0) {
    candidates.push(mkCandidate("operating_company", "acquisition", "acquisition", acquisition.score, acquisition.signals));
  }

  if (startupRaise.score > 0) {
    const structure = /\bsafe\b/.test(textLc) ? "safe" : /priced\s+round|series\s+[ab]/.test(textLc) ? "priced_round" : "equity_raise";
    candidates.push(mkCandidate("operating_company", structure, "startup_raise", startupRaise.score, startupRaise.signals));
  }

  // Always include an unknown candidate as a safe fallback.
  candidates.push(mkCandidate("unknown", "unknown", null, 0.5, ["Default fallback: insufficient deterministic signals"])) ;

  const sorted = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  const selected = sorted[0];
  const top2 = sorted.length >= 2 ? sorted.slice(0, 2) : null;

  const routing_reason: string[] = [];

  let selected_policy: DealPolicyId = routePolicyFromCandidate(selected);

  const topConfidence = selected?.confidence ?? 0;
  if (topConfidence < 0.7) {
    routing_reason.push(`Top confidence ${topConfidence.toFixed(2)} < 0.70; routing to unknown_generic`);
    selected_policy = "unknown_generic";
  }

  if (top2) {
    const diff = Math.abs(top2[0].confidence - top2[1].confidence);
    if (diff <= 0.1) {
      routing_reason.push(`Hybrid ambiguity: top2 confidence diff ${diff.toFixed(2)} <= 0.10; routing to unknown_generic`);
      selected_policy = "unknown_generic";
    }
  }

  // If selected policy is unknown but selected classification is still meaningful, keep it.
  if (routing_reason.length === 0) {
    routing_reason.push(`Routed by deterministic classification: ${selected.asset_class}/${selected.deal_structure}`);
  }

  return {
    candidates: sorted,
    selected,
    selected_policy,
    routing_reason,
  };
}

export function classifyDealForDioLike(dioLike: any): DealClassificationResult {
  const documents = dioLike?.inputs?.documents;
  const evidence = dioLike?.inputs?.evidence;
  return classifyDealV1({ documents, evidence });
}
