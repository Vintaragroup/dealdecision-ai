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
  phase1?: any;
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

  const phase1 = input.phase1 && typeof input.phase1 === "object" ? input.phase1 : null;
  if (phase1) {
    const add = (v: unknown): void => {
      if (typeof v === "string" && v.trim()) snippets.push(v);
    };

    const addMany = (arr: unknown, limit = 50): void => {
      if (!Array.isArray(arr)) return;
      for (const v of arr.slice(0, limit)) add(v);
    };

    const exec = phase1.executive_summary_v1 && typeof phase1.executive_summary_v1 === "object" ? phase1.executive_summary_v1 : null;
    if (exec) {
      add(exec.title);
      add(exec.one_liner);
      add(exec.deal_type);
      add(exec.raise);
      add(exec.business_model);
      addMany(exec.traction_signals, 30);
      addMany(exec.key_risks_detected, 30);
      addMany(exec.unknowns, 30);
    }

    const decision = phase1.decision_summary_v1 && typeof phase1.decision_summary_v1 === "object" ? phase1.decision_summary_v1 : null;
    if (decision) {
      addMany(decision.reasons, 30);
      addMany(decision.blockers, 30);
      addMany(decision.next_requests, 30);
    }

    const overview = phase1.deal_overview_v2 && typeof phase1.deal_overview_v2 === "object" ? phase1.deal_overview_v2 : null;
    if (overview) {
      add(overview.deal_name);
      add(overview.product_solution);
      add(overview.market_icp);
      add(overview.deal_type);
      add(overview.raise);
      add(overview.business_model);
      addMany(overview.traction_signals, 30);
      addMany(overview.key_risks_detected, 30);
    }

    const archetype = phase1.business_archetype_v1 && typeof phase1.business_archetype_v1 === "object" ? phase1.business_archetype_v1 : null;
    if (archetype) {
      add(archetype.value);
    }

    const claims = Array.isArray(phase1.claims) ? phase1.claims : [];
    for (const c of claims.slice(0, 50)) {
      add(c?.text);
    }
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
  policy_id: DealPolicyId | null,
  confidence: number,
  signals: string[]
): DealClassification {
  return {
    asset_class,
    deal_structure: toSnakeCase(deal_structure) || "unknown",
    strategy_subtype: strategy_subtype ? toSnakeCase(strategy_subtype) : null,
    // Additive classification upgrade: explicit policy id + raw score.
    // Keep optional for backward compatibility with legacy consumers.
    policy_id: policy_id ?? undefined,
    score: clamp01(confidence),
    confidence: clamp01(confidence),
    signals,
  };
}

function routePolicyFromCandidate(c: DealClassification): DealPolicyId {
  if (c.asset_class === "real_estate") return "real_estate_underwriting";
  if (c.asset_class === "fund_vehicle") return "fund_spv";
  if (c.asset_class === "credit") return "credit_memo";

  if (c.strategy_subtype === "execution_ready_v1") return "execution_ready_v1";
  if (c.strategy_subtype === "consumer_ecommerce_brand_v1") return "consumer_ecommerce_brand_v1";
  if (c.strategy_subtype === "consumer_fintech_platform_v1") return "consumer_fintech_platform_v1";
  if (c.strategy_subtype === "operating_startup_revenue_v1") return "operating_startup_revenue_v1";
  if (c.strategy_subtype === "operating_business") return "operating_business";

  // Operating company can still be acquisition/startup raise.
  if (c.deal_structure === "acquisition" || c.deal_structure === "asset_purchase") return "acquisition_memo";
  if (c.deal_structure === "safe" || c.deal_structure === "priced_round" || c.deal_structure === "equity_raise") return "startup_raise";

  return "unknown_generic";
}

export function classifyDealV1(input: TextInputs): DealClassificationResult {
  const { text } = normalizeTextInputs(input);
  const textLc = text.toLowerCase();

  const hasRevenueSignal = /\barr\b|\bmrr\b|\brevenue\b|\bsales\b|\bbookings\b|\$\s*\d{1,3}(?:,\d{3})+/.test(textLc);
  const explicitlyPreRevenue = /pre[-\s]?revenue|no\s+revenue|revenue\s*:\s*\$?0\b/.test(textLc);
  const looksPreRevenue = explicitlyPreRevenue || !hasRevenueSignal;
  const earlyStageStartupSignal = /\bseed\b|\bpre[-\s]?seed\b|\bearly\s+stage\b|\bstartup\b|\bpilot\b|\bbeta\b/.test(textLc);

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

  // Execution-ready (pre-revenue) signals: evidence of readiness without revenue.
  const executionReadyRules: SignalRule[] = [
    { id: "loi_or_contract", re: /\bloi\b|letter\s+of\s+intent|signed\s+(?:contract|agreement)|master\s+services\s+agreement|msa\b|purchase\s+order|po\b/, weight: 0.3, reason: "loi_or_contract" },
    { id: "partnership_or_distribution", re: /partnership\b|strategic\s+partner|distribution\b|distribution\s+partner|channel\s+partner|reseller\b|\bwholesale\b/, weight: 0.25, reason: "partnership_or_distribution" },
    { id: "manufacturing_ready", re: /manufacturer\b|manufacturing\b|contract\s+manufacturer|cm\b|pilot\s+run|production\s+ready|tooling\b|\bqc\b|quality\s+control/, weight: 0.2, reason: "manufacturing_ready" },
    { id: "regulatory_ready", re: /regulatory\b|fda\b|510\(k\)|ce\s*mark|hipaa\b|soc\s*2|iso\s*13485|gmp\b|compliance\b/, weight: 0.2, reason: "regulatory_ready" },
    { id: "product_ready", re: /mvp\b|product\s+complete|ready\s+to\s+launch|launched\s+beta|ga\b|general\s+availability|v1\b/, weight: 0.25, reason: "product_ready" },
    { id: "launch_timeline", re: /launch\s+in\s+\d+\s+months?|launch\s+date\b|go[-\s]?to[-\s]?market|gtm\b|rollout\b/, weight: 0.25, reason: "launch_timeline" },
  ];

  const operatingBusinessRules: SignalRule[] = [
    { id: "revenue", re: /\brevenue\b|\bsales\b|\barr\b|\bmrr\b|\bbookings\b/, weight: 0.35, reason: "revenue" },
    { id: "margin", re: /gross\s+margin|\bgm\b|contribution\s+margin|ebitda\b/, weight: 0.25, reason: "gross_margin_or_unit_economics" },
    { id: "retention", re: /churn\b|retention\b|ndr\b|nrr\b/, weight: 0.2, reason: "retention_or_churn" },
    { id: "ops", re: /operating\s+plan|kpi\b|cohort\b|unit\s+economics/, weight: 0.15, reason: "risk_controls" },
  ];

  // Consumer ecommerce / DTC brand signals: prefer distinct unit economics + channel language.
  const consumerEcommerceRules: SignalRule[] = [
    { id: "dtc", re: /\bdtc\b|direct[-\s]?to[-\s]?consumer|direct[-\s]?to[-\s]?consumer\b/, weight: 0.25, reason: "DTC / direct-to-consumer" },
    { id: "shopify", re: /\bshopify\b|\bshopify\s+plus\b/, weight: 0.25, reason: "Shopify" },
    { id: "amazon", re: /\bamazon\b|\bfba\b|seller\s+central/, weight: 0.2, reason: "Amazon channel" },
    { id: "sku", re: /\bsku\b|\bskus\b|product\s+catalog|assortment\b/, weight: 0.15, reason: "SKU / assortment" },
    { id: "aov", re: /\baov\b|average\s+order\s+value/, weight: 0.25, reason: "AOV" },
    { id: "cac", re: /\bcac\b|customer\s+acquisition\s+cost/, weight: 0.25, reason: "CAC" },
    { id: "ltv", re: /\bltv\b|lifetime\s+value/, weight: 0.25, reason: "LTV" },
    { id: "ltv_cac", re: /ltv\s*[:\/]?\s*cac|lifetime\s+value\s*[:\/]?\s*customer\s+acquisition\s+cost/, weight: 0.35, reason: "LTV:CAC" },
    { id: "roas", re: /\broas\b|return\s+on\s+ad\s+spend/, weight: 0.25, reason: "ROAS" },
    { id: "conversion", re: /conversion\s+rate|\bcvr\b/, weight: 0.2, reason: "Conversion rate" },
    { id: "repeat_purchase", re: /repeat\s+purchase|repeat\s+rate|reorder\s+rate|repurchase|cohort/, weight: 0.25, reason: "Repeat purchase / cohorts" },
    { id: "gross_margin", re: /gross\s+margin|contribution\s+margin/, weight: 0.15, reason: "Margin" },
    { id: "subscription", re: /subscription\s+box|subscribe\s+\&\s+save|subscribe\s+and\s+save|\bsubscription\b/, weight: 0.15, reason: "Subscription model" },
  ];

  // Consumer fintech platform signals: payments/wallets/BNPL/remittance/etc.
  // Keep this deterministic and distinct from generic "credit memo" language.
  const consumerFintechRules: SignalRule[] = [
    { id: "payments", re: /payments?\b|payment\s+processing|payment\s+gateway|\bacquirer\b|\bmerchant\s+acquiring\b/, weight: 0.25, reason: "Payments / processing" },
    { id: "wallet", re: /digital\s+wallet|\bwallet\b|stored\s+value|\bprepaid\b/, weight: 0.25, reason: "Wallet / stored value" },
    { id: "card", re: /debit\s+card|credit\s+card|card\s+issuing|issuer\b|interchange\b|\bcard\s+network\b/, weight: 0.2, reason: "Card issuing / interchange" },
    { id: "bnpl", re: /\bbnpl\b|buy\s+now\s+pay\s+later|pay\s+in\s+\d+\s+installments?/, weight: 0.25, reason: "BNPL" },
    { id: "remittance", re: /remittance|money\s+transfer|cross[-\s]?border|international\s+transfers?|\bfx\b|foreign\s+exchange/, weight: 0.2, reason: "Remittance / cross-border" },
    { id: "embedded", re: /embedded\s+finance|banking\s+as\s+a\s+service|\bbaas\b|embedded\s+payments?/, weight: 0.2, reason: "Embedded finance / BaaS" },
    { id: "compliance", re: /\bkyc\b|\baml\b|anti[-\s]?money\s+laundering|sanctions|\bofac\b|finCEN|\bfinra\b|\bregulatory\b|\blicen[cs]e\b|money\s+transmitter|\bmtl\b/, weight: 0.25, reason: "KYC/AML / regulatory" },
    { id: "volume", re: /\btpv\b|\bgtv\b|transaction\s+volume|payment\s+volume|processed\s+\$|\btransactions?\b\s*[:=]/, weight: 0.25, reason: "TPV/GTV / transaction volume" },
    { id: "unit_econ", re: /take\s*rate|interchange\s*rate|net\s+revenue|gross\s+profit|contribution\s+margin/, weight: 0.15, reason: "Take rate / unit economics" },
    { id: "fraud", re: /fraud\s*rate|chargeback\s*rate|disputes?\b|\bchargebacks?\b/, weight: 0.2, reason: "Fraud/chargeback controls" },
  ];

  // Healthcare / biotech (domain) signals.
  const healthcareBiotechRules: SignalRule[] = [
    // Core regulatory path signals (needed for >75 gating).
    // Avoid treating bare "FDA" (or "FDA pathway not required") as a positive biotech signal.
    { id: "regulatory_path_clear", re: /\bind\b|investigational\s+new\s+drug|\bide\b|investigational\s+device\s+exemption|510\(k\)|\bpma\b|de\s*novo|\beua\b|emergency\s+use\s+authorization|\bfda\s+(?:clearance|approval|submission|filing|pma|510\(k\)|de\s*novo|eua)/, weight: 0.3, reason: "regulatory_path_clear" },

    // Validation signals: trials/IRB/data/endpoints/peer-reviewed performance.
    { id: "trial_phase", re: /clinical\s+trial|trial\s+phase|phase\s+(?:i|ii|iii|iv|1|2|3|4)\b|first[-\s]?in[-\s]?human|pivotal\s+trial/, weight: 0.25, reason: "validation_signal" },
    { id: "irb", re: /\birb\b|institutional\s+review\s+board/, weight: 0.2, reason: "validation_signal" },
    { id: "endpoints", re: /primary\s+endpoint|secondary\s+endpoint|endpoint\b|\bp[-\s]?value\b|statistically\s+significant/, weight: 0.2, reason: "validation_signal" },
    { id: "sensitivity_specificity", re: /sensitivity\b|specificity\b|auc\b|area\s+under\s+the\s+curve|roc\s+curve|ppv\b|npv\b/, weight: 0.25, reason: "strong_validation_metrics" },
    { id: "peer_reviewed", re: /peer[-\s]?reviewed|publication\b|published\b|preprint\b|\bnejm\b|\bjama\b|\bnature\b|\bcell\b|\blancet\b/, weight: 0.2, reason: "validation_signal" },

    // Reimbursement and go-to-market in healthcare.
    { id: "reimbursement", re: /reimbursement|\bcpt\b\s*code|\bdrg\b|icd[-\s]?10|payer\b|coverage\b|\bmedicare\b|\bmedicaid\b/, weight: 0.2, reason: "reimbursement_path" },

    // Compliance posture signals.
    { id: "hipaa", re: /\bhipaa\b|business\s+associate\s+agreement|\bbaa\b/, weight: 0.15, reason: "risk_controls" },

    // Team credibility signals (heuristic).
    { id: "kol_pi", re: /\bkol\b|key\s+opinion\s+leader|principal\s+investigator|clinical\s+advisor|medical\s+advisor/, weight: 0.2, reason: "team_credibility" },
    { id: "clinical_credentials", re: /\bmd\b|\bphd\b|\bdo\b|board[-\s]?certified|former\s+fda|ex[-\s]?fda/, weight: 0.15, reason: "team_credibility" },

    // Timeline/cost realism signals.
    { id: "timeline_costs", re: /\b(\d{1,2})\s*(?:months?|mos\.?)(?:\s+to\s+)?(?:clearance|approval)|time\s+to\s+(?:clearance|approval)|runway\b|cash\s+runway|burn\s+rate|monthly\s+burn/, weight: 0.2, reason: "timeline_costs_realistic" },

    // Explicit negatives (used for policy-local caps/diagnostics).
    // These should NOT increase healthcare domain confidence; they're only for caps/diagnostics.
    { id: "regulatory_unclear", re: /unclear\s+regulatory|regulatory\s+path\s+(?:tbd|unknown|unclear)|no\s+fda\s+pathway|fda\s+pathway\s+(?:tbd|unknown)|pre[-\s]?clinical\s+only\s+no\s+ind/, weight: 0, reason: "regulatory_path_unclear" },
    { id: "safety_ethics_risk", re: /fabricat(?:ed|ion)\s+data|falsif(?:ied|y)|fraudulent\s+claims?|no\s+irb|irb\s+(?:missing|not\s+obtained)|hipaa\s+violat|non[-\s]?compliant|unapproved\s+claims?|misrepresent/, weight: 0, reason: "safety_ethics_risk" },
  ];

  // Enterprise SaaS (B2B) (domain) signals.
  const enterpriseSaasRules: SignalRule[] = [
    { id: "arr_mrr", re: /\barr\b|\bmrr\b|\bbookings\b/, weight: 0.25, reason: "ARR/MRR/Bookings" },
    { id: "retention", re: /\bnrr\b|\bndr\b|net\s+revenue\s+retention|churn/, weight: 0.2, reason: "NRR/NDR/Churn" },
    { id: "acv_pipeline", re: /\bacv\b|pipeline|\bdeal\s+cycle\b|\bquota\b/, weight: 0.2, reason: "ACV / pipeline" },
    { id: "enterprise", re: /enterprise\b|procurement|\bsecurity\s+review\b/, weight: 0.15, reason: "Enterprise / procurement" },
    { id: "security", re: /\bsoc\s*2\b|\bsso\b|saml|\bscim\b|\biso\s*27001\b/, weight: 0.2, reason: "SOC2/SSO/SAML" },
    { id: "pricing", re: /seat[-\s]?based|usage[-\s]?based|per\s+seat|per\s+user/, weight: 0.15, reason: "Seat/usage-based" },
  ];

  // Media / entertainment / IP (domain) signals.
  const mediaIpRules: SignalRule[] = [
    // Rights / chain-of-title
    { id: "rights", re: /chain\s+of\s+title|copyright\b|trademark\b|underlying\s+rights|life\s+rights|life\s+story\s+rights|rights\s+agreement/, weight: 0.25, reason: "rights_verifiable" },
    { id: "option", re: /option\s+agreement|optioned\b|shopping\s+agreement|purchase\s+of\s+rights/, weight: 0.25, reason: "rights_verifiable" },

    // Slate / packaging / attachments
    { id: "slate", re: /\bslate\b|multi[-\s]?project|pipeline\s+of\s+(?:projects|titles)/, weight: 0.2, reason: "slate_count" },
    { id: "attachments", re: /talent\s+attach(?:ment|ed)|attached\s+(?:talent|director|producer|cast)|\bcast\b\s+attached|\bdirector\b\s+attached|showrunner\b\s+attached|a[-\s]?list\b|name\s+talent/, weight: 0.25, reason: "strong_attachments" },
    { id: "unions", re: /sag[-\s]?aftra|\bwga\b|dga\b|iatse\b|union\s+agreement|guild\s+agreement/, weight: 0.15, reason: "risk_controls" },

    // Distribution economics (distribution / MG / pre-sales)
    { id: "distribution", re: /distribution\s+agreement|\bdistributor\b|sales\s+agent|\bstreaming\b|\btheatrical\b|box\s+office/, weight: 0.2, reason: "distribution_package" },
    { id: "minimum_guarantee", re: /minimum\s+guarantee|\bmg\b\s*(?:amount|deal|terms)?/, weight: 0.25, reason: "distribution_package" },
    { id: "presales", re: /pre[-\s]?sales|presales\b|territory\s+pre[-\s]?sale|international\s+pre[-\s]?sales/, weight: 0.25, reason: "distribution_package" },

    // Financing / completion / recoupment structure
    { id: "financing_plan", re: /financing\s+plan|budget\b|production\s+budget|gap\s+financ(?:e|ing)|equity\s+financ(?:e|ing)|debt\s+financ(?:e|ing)|slate\s+financ(?:e|ing)/, weight: 0.2, reason: "financing_plan" },
    { id: "completion_bond", re: /completion\s+bond|bonded\b|bond\s+provider/, weight: 0.2, reason: "completion_bond_plan" },
    { id: "waterfall_recoupment", re: /waterfall\b|recoup(?:ment|s)?\b|recoupment\s+schedule|investor\s+recoup|distribution\s+waterfall/, weight: 0.2, reason: "waterfall_recoupment_clarity" },

    // Low-signal general IP terms; keep weight low to avoid spurious routing from software licensing.
    { id: "licensing", re: /\bip\b\s*(?:rights|library)?|licens(?:e|ing)|royalt(?:y|ies)/, weight: 0.1, reason: "Licensing / royalties" },
    { id: "catalog", re: /\bcatalog\b|\bback\s*catalog\b/, weight: 0.1, reason: "Catalog" },

    // Negative triggers (for policy-local diagnostics/caps only; do not increase domain confidence).
    { id: "rights_unclear", re: /unclear\s+rights|rights\s+unclear|chain\s+of\s+title\s+(?:unclear|missing)|missing\s+chain\s+of\s+title|rights\s+not\s+secured/, weight: 0, reason: "rights_unclear" },
    { id: "no_distribution_path", re: /no\s+distribution\s+path|no\s+distributor|without\s+a\s+distributor|still\s+seeking\s+distribution|distribution\s+not\s+secured/, weight: 0, reason: "no_distribution_path" },
    { id: "aggressive_assumptions_no_comps", re: /no\s+comps|without\s+comps|no\s+comparables|assumptions\s+without\s+comps|blockbuster\s+assumptions|aggressive\s+assumptions/, weight: 0, reason: "aggressive_assumptions_no_comps" },
    { id: "recoupment_waterfall_unclear", re: /recoupment\s+(?:tbd|unknown|unclear)|waterfall\s+(?:tbd|unknown|unclear)|missing\s+waterfall|no\s+waterfall\s+defined/, weight: 0, reason: "recoupment_waterfall_unclear" },
  ];

  // Physical product / CPG / spirits (domain) signals.
  const physicalCpgSpiritsRules: SignalRule[] = [
    { id: "spirits", re: /\bspirits\b|\bliquor\b|\balcohol\b|\bvodka\b|\bwhisk(?:e)?y\b|\bbourbon\b|\bg(?:i|in)\b|\btequila\b|\brum\b|distill(?:ery|ed|ation)/, weight: 0.25, reason: "spirits" },
    { id: "wholesale", re: /wholesale|distributor|distribution\s+partner|three[-\s]?tier|tier\s+system/, weight: 0.25, reason: "distribution_traction_or_agreements" },
    { id: "signed_distribution", re: /signed\s+distribution\s+agreement|distribution\s+agreement\s+signed|signed\s+with\s+(?:a\s+)?distributor|master\s+distribution\s+agreement/, weight: 0.25, reason: "signed_distribution_agreement" },
    { id: "production", re: /contract\s+manufacturer|co[-\s]?packer|copacker|pilot\s+run|production\s+ready|batch\s+production|distillation\s+run/, weight: 0.2, reason: "production_ready" },
    { id: "velocity_turns", re: /\bsku\b|retail\s+velocity|\bvelocity\b|inventory\s+turns?|sell[-\s]?through/, weight: 0.2, reason: "repeat_or_velocity" },
    { id: "channels", re: /on[-\s]?premise|off[-\s]?premise|\bretail\b|\bgrocery\b|liquor\s+store/, weight: 0.15, reason: "channels" },
    { id: "working_capital", re: /working\s+capital\s+plan|inventory\s+financ|purchase\s+orders?\s+financ|cash\s+conversion\s+cycle/, weight: 0.2, reason: "working_capital_plan" },
    { id: "ttb", re: /\bttb\b|excise\s+tax|distilled\s+spirits\s+permit|\bdsp\b\s+permit|alcohol\s+licen[cs]e|abc\s+licen[cs]e|state\s+licen[cs]e/, weight: 0.25, reason: "regulatory_compliance" },
    { id: "ttb_unclear", re: /ttb\s+(?:pending|in\s+process)|licen[cs]e\s+(?:pending|awaiting)|not\s+licensed|permit\s+(?:pending|awaiting)/, weight: 0.25, reason: "ttb_compliance_unclear" },
    { id: "margins", re: /gross\s+margin|contribution\s+margin|\bunit\s+margins?\b|\bmargins?\b/, weight: 0.1, reason: "gross_margin_or_unit_economics" },
    { id: "chargebacks_returns", re: /chargebacks?|returns?\s+rate|high\s+returns?/, weight: 0.1, reason: "chargebacks_or_returns" },
    { id: "no_distribution", re: /no\s+distribution|no\s+distributor|without\s+a\s+distributor|still\s+seeking\s+distribution|yet\s+to\s+secure\s+distribution/, weight: 0.25, reason: "no_distribution_path" },
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
  const executionReady = scoreSignals(textLc, executionReadyRules);
  const operatingBusiness = scoreSignals(textLc, operatingBusinessRules);
  const consumerEcommerce = scoreSignals(textLc, consumerEcommerceRules);
  const consumerFintech = scoreSignals(textLc, consumerFintechRules);
  const healthcareBiotech = scoreSignals(textLc, healthcareBiotechRules);
  const enterpriseSaas = scoreSignals(textLc, enterpriseSaasRules);
  const mediaIp = scoreSignals(textLc, mediaIpRules);
  const physicalCpgSpirits = scoreSignals(textLc, physicalCpgSpiritsRules);

  const candidates: DealClassification[] = [];

  const pickBestPolicyCandidate = (cs: DealClassification[]): { best: DealClassification; policyId: DealPolicyId } => {
    const sorted = cs.sort((a, b) => b.confidence - a.confidence);
    const best = sorted[0];
    const pid = (best as any)?.policy_id as DealPolicyId | undefined;
    const policyId = pid ?? routePolicyFromCandidate(best);
    return { best, policyId };
  };

  const finalizeCandidates = (
    cs: DealClassification[],
    domainCandidates: { policyId: DealPolicyId; confidence: number; signals: string[] }[]
  ): DealClassificationResult => {
    // Always include an unknown candidate as a safe fallback.
    cs.push(mkCandidate("unknown", "unknown", null, null, 0.5, ["Default fallback: insufficient deterministic signals"])) ;

    const sorted = cs.sort((a, b) => b.confidence - a.confidence).slice(0, 5);

    const selected = sorted[0];
    const top2 = sorted.length >= 2 ? sorted.slice(0, 2) : null;

    const routing_reason: string[] = [];

    // Domain-first routing: compute broad domain candidates and pick best domain.
    const domainSorted = [...domainCandidates].sort((a, b) => b.confidence - a.confidence);
    const bestDomain = domainSorted.length > 0 ? domainSorted[0] : null;
    const domain_policy_id: DealPolicyId = bestDomain && bestDomain.confidence >= 0.6 ? bestDomain.policyId : "unknown_generic";

    // Sub-policy routing: prefer the best explicit policy candidate when it's sufficiently confident.
    // Otherwise, fall back to the chosen domain policy (reduces unknown_generic when domain signals exist).
    const { best: bestSubPolicyCandidate, policyId: bestSubPolicyId } = pickBestPolicyCandidate(sorted);
    const strongSubPolicyThreshold = 0.7;
    const selected_policy: DealPolicyId = (bestSubPolicyCandidate.confidence ?? 0) >= strongSubPolicyThreshold
      ? bestSubPolicyId
      : domain_policy_id;

    const topConfidence = selected?.confidence ?? 0;
    if (topConfidence < 0.7) {
      routing_reason.push(`Top candidate confidence ${topConfidence.toFixed(2)} < 0.70; using domain policy ${domain_policy_id}`);
    }

    if (top2) {
      const diff = Math.abs(top2[0].confidence - top2[1].confidence);
      if (diff <= 0.1) {
        routing_reason.push(`Hybrid ambiguity: top2 confidence diff ${diff.toFixed(2)} <= 0.10; using domain policy ${domain_policy_id}`);
      }
    }

    if (selected_policy === "unknown_generic") {
      routing_reason.push("No strong sub-policy or domain signals; routing to unknown_generic");
    } else {
      routing_reason.push(`Selected policy=${selected_policy} (domain=${domain_policy_id})`);
    }

    return {
      candidates: sorted,
      selected,
      domain_policy_id,
      selected_policy,
      routing_reason,
    };
  };

  const domainCandidates: { policyId: DealPolicyId; confidence: number; signals: string[] }[] = [];

  // Domain candidates (broad routing)
  if (realEstate.score > 0) {
    // Treat real estate as a high-confidence domain when present.
    domainCandidates.push({ policyId: "real_estate_underwriting", confidence: clamp01(realEstate.score + 0.15), signals: realEstate.signals });
    const structure = /preferred\s+equity|pref\.?\s+equity/.test(textLc) ? "preferred_equity" : "equity_raise";
    candidates.push(
      mkCandidate(
        "real_estate",
        structure,
        structure === "preferred_equity" ? "real_estate_preferred_equity" : "real_estate",
        "real_estate_underwriting",
        realEstate.score,
        realEstate.signals
      )
    );
  }

  if (consumerFintech.score > 0) {
    domainCandidates.push({ policyId: "consumer_fintech_platform_v1", confidence: consumerFintech.score, signals: consumerFintech.signals });
  }

  if (consumerEcommerce.score > 0) {
    domainCandidates.push({ policyId: "consumer_ecommerce_brand_v1", confidence: consumerEcommerce.score, signals: consumerEcommerce.signals });
  }

  if (healthcareBiotech.score > 0) {
    domainCandidates.push({ policyId: "healthcare_biotech_v1", confidence: healthcareBiotech.score, signals: healthcareBiotech.signals });
  }

  if (enterpriseSaas.score > 0) {
    domainCandidates.push({ policyId: "enterprise_saas_b2b_v1", confidence: enterpriseSaas.score, signals: enterpriseSaas.signals });
  }

  if (mediaIp.score > 0) {
    domainCandidates.push({ policyId: "media_entertainment_ip_v1", confidence: mediaIp.score, signals: mediaIp.signals });
  }

  if (physicalCpgSpirits.score > 0) {
    domainCandidates.push({ policyId: "physical_product_cpg_spirits_v1", confidence: physicalCpgSpirits.score, signals: physicalCpgSpirits.signals });
  }

  if (fund.score > 0) {
    const structure = /\bspv\b|special\s+purpose\s+vehicle/.test(textLc) ? "spv" : "fund_vehicle";
    candidates.push(mkCandidate("fund_vehicle", structure, "fund_vehicle", "fund_spv", fund.score, fund.signals));
  }

  if (credit.score > 0) {
    const structure = /mezzanine|\bmezz\b/.test(textLc) ? "mezzanine_debt" : /senior\s+debt/.test(textLc) ? "senior_debt" : "credit";
    candidates.push(mkCandidate("credit", structure, "credit", "credit_memo", credit.score, credit.signals));
  }

  if (acquisition.score > 0) {
    candidates.push(mkCandidate("operating_company", "acquisition", "acquisition", "acquisition_memo", acquisition.score, acquisition.signals));
  }

  if (startupRaise.score > 0 && consumerFintech.score < 0.8) {
    const structure = /\bsafe\b/.test(textLc) ? "safe" : /priced\s+round|series\s+[ab]/.test(textLc) ? "priced_round" : "equity_raise";
    candidates.push(mkCandidate("operating_company", structure, "startup_raise", "startup_raise", startupRaise.score, startupRaise.signals));
  }

  // Consumer fintech platform: route deterministically when multiple strong signals exist.
  // Keep this ahead of ecommerce/execution-ready/operating-business to avoid near-ties and ambiguity fallback.
  if (consumerFintech.score >= 0.8 && credit.score < 0.6 && realEstate.score < 0.4 && fund.score < 0.4) {
    // If a venture raise is also present, slightly boost confidence to make routing deterministic.
    const boosted = clamp01(consumerFintech.score + (startupRaise.score > 0 ? 0.1 : 0));

    candidates.push(
      mkCandidate(
        "operating_company",
        "consumer_fintech_platform_v1",
        "consumer_fintech_platform_v1",
        "consumer_fintech_platform_v1",
        boosted,
        consumerFintech.signals
      )
    );

    return finalizeCandidates(candidates, domainCandidates);
  }

  // Consumer ecommerce brand: route deterministically when multiple strong signals exist.
  // Keep this ahead of execution-ready/operating-business to avoid near-ties and ambiguity fallback.
  if (consumerEcommerce.score >= 0.8 && startupRaise.score < 0.4 && acquisition.score < 0.4) {
    candidates.push(
      mkCandidate(
        "operating_company",
        "consumer_ecommerce_brand_v1",
        "consumer_ecommerce_brand_v1",
        "consumer_ecommerce_brand_v1",
        consumerEcommerce.score,
        consumerEcommerce.signals
      )
    );

    return finalizeCandidates(candidates, domainCandidates);
  }

  // Execution-ready: only consider when pre-revenue (or explicitly pre-revenue) and readiness evidence exists.
  if (looksPreRevenue && executionReady.score >= 0.7) {
    candidates.push(
      mkCandidate(
        "operating_company",
        "equity_raise",
        "execution_ready_v1",
        "execution_ready_v1",
        Math.min(1, executionReady.score + 0.1),
        executionReady.signals
      )
    );
  }

  // Domain-only candidates (broad routing) when we don't have a stronger sub-policy match.
  if (healthcareBiotech.score >= 0.6) {
    candidates.push(
      mkCandidate(
        "operating_company",
        "equity_raise",
        "healthcare_biotech_v1",
        "healthcare_biotech_v1",
        healthcareBiotech.score,
        healthcareBiotech.signals
      )
    );
  }

  if (enterpriseSaas.score >= 0.6) {
    candidates.push(
      mkCandidate(
        "operating_company",
        "equity_raise",
        "enterprise_saas_b2b_v1",
        "enterprise_saas_b2b_v1",
        enterpriseSaas.score,
        enterpriseSaas.signals
      )
    );
  }

  if (mediaIp.score >= 0.6) {
    candidates.push(
      mkCandidate(
        "operating_company",
        "equity_raise",
        "media_entertainment_ip_v1",
        "media_entertainment_ip_v1",
        mediaIp.score,
        mediaIp.signals
      )
    );
  }

  if (physicalCpgSpirits.score >= 0.6) {
    candidates.push(
      mkCandidate(
        "operating_company",
        "equity_raise",
        "physical_product_cpg_spirits_v1",
        "physical_product_cpg_spirits_v1",
        physicalCpgSpirits.score,
        physicalCpgSpirits.signals
      )
    );
  }

  // Operating business: revenue/margin signals without strong acquisition/raise cues.
  if (operatingBusiness.score >= 0.7 && startupRaise.score < 0.4 && acquisition.score < 0.4) {
    // Revenue + startup framing: treat as operating startup rather than mature operating_business.
    if (hasRevenueSignal && earlyStageStartupSignal) {
      candidates.push(
        mkCandidate(
          "operating_company",
          "operating_startup_revenue_v1",
          "operating_startup_revenue_v1",
          "operating_startup_revenue_v1",
          Math.min(1, operatingBusiness.score + 0.1),
          operatingBusiness.signals
        )
      );

      // Avoid a near-tie with operating_business that would trigger the ambiguity fallback.
      // When the deck clearly frames "startup + revenue", prefer the more specific policy.
      return finalizeCandidates(candidates, domainCandidates);
    }

    candidates.push(
      mkCandidate(
        "operating_company",
        "operating_business",
        "operating_business",
        "operating_business",
        operatingBusiness.score,
        operatingBusiness.signals
      )
    );
  }


  // Ensure at least one domain candidate exists when any of the broad domain signals are present.
  // This prevents avoidable fallbacks to unknown_generic.
  if (domainCandidates.length === 0 && consumerFintech.score > 0) {
    domainCandidates.push({ policyId: "consumer_fintech_platform_v1", confidence: consumerFintech.score, signals: consumerFintech.signals });
  }
  if (domainCandidates.length === 0 && consumerEcommerce.score > 0) {
    domainCandidates.push({ policyId: "consumer_ecommerce_brand_v1", confidence: consumerEcommerce.score, signals: consumerEcommerce.signals });
  }
  if (domainCandidates.length === 0 && healthcareBiotech.score > 0) {
    domainCandidates.push({ policyId: "healthcare_biotech_v1", confidence: healthcareBiotech.score, signals: healthcareBiotech.signals });
  }
  if (domainCandidates.length === 0 && enterpriseSaas.score > 0) {
    domainCandidates.push({ policyId: "enterprise_saas_b2b_v1", confidence: enterpriseSaas.score, signals: enterpriseSaas.signals });
  }

  return finalizeCandidates(candidates, domainCandidates);
}

export function classifyDealForDioLike(dioLike: any): DealClassificationResult {
  const documents = dioLike?.inputs?.documents;
  const evidence = dioLike?.inputs?.evidence;
  const phase1 = dioLike?.phase1 ?? dioLike?.dio?.phase1;
  return classifyDealV1({ documents, evidence, phase1 });
}
