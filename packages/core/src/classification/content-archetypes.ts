export type ContentArchetypeTag =
  // Medical / clinical decks
  | "medical_research_findings"
  | "medical_how_to_procedure"
  | "medical_regulatory"
  | "medical_education"
  // Product / software decks
  | "product_tutorial"
  | "product_use_case_examples"
  | "product_case_study"
  | "product_how_it_works"
  | "technical_architecture"
  | "integration_implementation"
  // Fundraising / investor materials
  | "market_overview"
  | "execution_timeline"
  | "capital_stack"
  | "track_record"
  | "sponsor_overview"
  | "tenant_operator_overview"
  | "cashflow_contract"
  // Real estate / development decks
  | "location_thesis"
  | "real_estate_site_plan"
  | "real_estate_entitlements_zoning"
  | "real_estate_unit_program"
  | "real_estate_construction_schedule"
  | "real_estate_sources_uses"
  | "real_estate_lease_terms";

export const ALL_CONTENT_ARCHETYPE_TAGS = [
  // Medical / clinical decks
  "medical_research_findings",
  "medical_how_to_procedure",
  "medical_regulatory",
  "medical_education",
  // Product / software decks
  "product_tutorial",
  "product_use_case_examples",
  "product_case_study",
  "product_how_it_works",
  "technical_architecture",
  "integration_implementation",
  // Fundraising / investor materials
  "market_overview",
  "execution_timeline",
  "capital_stack",
  "track_record",
  "sponsor_overview",
  "tenant_operator_overview",
  "cashflow_contract",
  // Real estate / development decks
  "location_thesis",
  "real_estate_site_plan",
  "real_estate_entitlements_zoning",
  "real_estate_unit_program",
  "real_estate_construction_schedule",
  "real_estate_sources_uses",
  "real_estate_lease_terms",
] as const satisfies ReadonlyArray<ContentArchetypeTag>;

type DetectInput = {
  title?: string | null;
  snippet?: string | null;
  ocr?: string | null;
  structured?: string | null;
};

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

// Heuristic-only: these tags are meant for audit/observability, not as a hard classifier.
// Design goals:
// - Program-wide: can tag across many deck types.
// - Gated: requires domain anchors so we don't spam tags on normal pitch decks.
// - Multi-label: a slide can be both architecture + integration, etc.
export function detectContentArchetypeTags(input: DetectInput): ContentArchetypeTag[] {
  const text = normalizeText([input.title, input.snippet, input.ocr, input.structured]);
  if (!text) return [];

  const has = (re: RegExp) => re.test(text);
  const digits = digitCount(text);

  // Domain anchors (gates)
  const medicalAnchor = has(
    /\b(clinical|patient|pediatric|paediatric|diagnos|treatment|symptom|toxic|toxicity|poison|exposure|blood|urine|saliva|specimen|assay|screening|fda|clia|510\(k\)|eua|cdc|nih|who|mg\/dl|mcg\/dl|ppm)\b/
  );
  const productAnchor = has(
    /\b(product|platform|software|workflow|dashboard|ui|ux|demo|walkthrough|api|sdk|integration|webhook|endpoint|architecture|pipeline|auth|oauth|sso|deploy|implementation)\b/
  );
  const realEstateAnchor = has(
    /\b(site\s*plan|parcel|zoning|entitlement|entitlements|permitting|permit|setback|easement|right[-\s]?of[-\s]?way|grading|drainage|utilities|acre|acres|sq\.?\s*ft|sf\b|units?\b|unit\s*mix|floor\s*plan|elevation|lot\b|lots\b|phase\b|phases\b|lease\b|leases\b|rent\b|tenant\b|occupancy\b|rent\s*roll|net\s+lease|nnn\b|walt\b|cam\b|psf\b)\b/
  );

  const fundOrRaiseAnchor = has(
    /\b(fund|gp\b|lp\b|limited partner|general partner|management fee|carry|carried interest|capital raise|raise terms|term sheet|safe\b|convertible note|valuation cap|pre[-\s]?money|post[-\s]?money|liquidation preference|pro\s*rata|warrant)\b/
  );

  const tags: ContentArchetypeTag[] = [];

  // --- Medical tags ---
  if (medicalAnchor) {
    let researchScore = 0;
    if (has(/\b(study|studies|trial|clinical trial|randomi[sz]ed|double[-\s]?blind|placebo|cohort|endpoint|methodology)\b/)) researchScore += 2;
    if (has(/\b(results?|findings?|data|evidence|validated|validation|benchmark|comparison|performance)\b/)) researchScore += 1;
    if (has(/\b(sensitivity|specificity|accuracy|auc|roc|ppv|npv|confidence interval|p\s*<\s*0\.|p-?value|n\s*=\s*\d+)\b/)) researchScore += 2;
    if (digits >= 14) researchScore += 1;

    let howToScore = 0;
    if (has(/\b(step\s*\d+|step[-\s]by[-\s]step|how to|instructions?)\b/)) howToScore += 2;
    if (has(/\b(procedure|protocol|workflow|process|kit contents|sample collection|specimen|interpret(ation)?|readout)\b/)) howToScore += 1;
    if (has(/\b(\d\s*[.)]\s*(open|insert|apply|collect|wait|remove|mix|shake|read|scan))\b/)) howToScore += 2;

    let regulatoryScore = 0;
    if (has(/\b(fda|clia|510\(k\)|eua|ce\s*mark|iso\s*13485|hipaa|gmp|regulatory|compliance|approved|clearance|certif|accredit)\b/)) regulatoryScore += 2;

    let educationScore = 0;
    if (has(/\b(what is|where does|sources? of|effects? of|symptoms?|signs? and symptoms|risk factors?|prevention|treatment|diagnosis|how does)\b/)) educationScore += 2;
    if (has(/\b(exposure|poison|toxicity|toxic|lead|mercury|arsenic|contaminant|pollution|hazard)\b/)) educationScore += 1;

    if (researchScore >= 2) tags.push("medical_research_findings");
    if (howToScore >= 2) tags.push("medical_how_to_procedure");
    if (regulatoryScore >= 2) tags.push("medical_regulatory");
    if (educationScore >= 2) tags.push("medical_education");
  }

  // --- Product / software tags ---
  if (productAnchor) {
    let tutorialScore = 0;
    if (has(/\b(tutorial|how to|walkthrough|step[-\s]by[-\s]step|getting started|quick start|setup|install(ation)?|configure|configuration)\b/)) tutorialScore += 2;
    if (has(/\b(click|select|open|navigate|create|add|upload|download|run|build|deploy)\b/)) tutorialScore += 1;
    if (has(/\b(1\.|2\.|3\.|step\s*1|step\s*2|step\s*3)\b/)) tutorialScore += 1;

    let examplesScore = 0;
    if (has(/\b(use cases?|use-case|example\b|examples\b|case\s*examples?)\b/)) examplesScore += 2;
    if (has(/\b(merchant|customer|user|persona|workflow|scenario|industry|vertical)\b/)) examplesScore += 1;

    let caseStudyScore = 0;
    if (has(/\b(case study|customer story|success story|testimonial|before\s+and\s+after|results|impact|roi)\b/)) caseStudyScore += 2;

    let architectureScore = 0;
    if (has(/\b(architecture|system design|data flow|sequence|components?|services?|microservices|kafka|queue|etl|pipeline|ingest(ion)?|vector|embedding|llm)\b/)) architectureScore += 2;
    if (has(/\b(diagram|flowchart|uml|swimlane)\b/)) architectureScore += 1;

    let integrationScore = 0;
    if (has(/\b(integration|integrations|implementation|rollout|migration|onboarding|go[-\s]?live|deployment|deploy|api|sdk|webhook|endpoint|auth|oauth|sso)\b/)) integrationScore += 2;

    let howItWorksScore = 0;
    if (has(/\b(how\s+it\s+works|how\s+we\s+work|how\s+it\s+work[s]?|how\s+does\s+it\s+work|how\s+we\s+do\s+it)\b/)) howItWorksScore += 2;
    if (has(/\b(workflow|process|steps?|pipeline|end[-\s]?to[-\s]?end)\b/)) howItWorksScore += 1;

    if (tutorialScore >= 2) tags.push("product_tutorial");
    if (examplesScore >= 2) tags.push("product_use_case_examples");
    if (caseStudyScore >= 2) tags.push("product_case_study");
    if (howItWorksScore >= 2) tags.push("product_how_it_works");
    if (architectureScore >= 2) tags.push("technical_architecture");
    if (integrationScore >= 2) tags.push("integration_implementation");
  }

  // --- Fundraising / investor materials ---
  {
    let marketScore = 0;
    if (has(/\b(tam|sam|som|cagr|market\s*size|total\s+addressable\s+market|serviceable\s+available\s+market|serviceable\s+obtainable\s+market)\b/)) marketScore += 2;
    if (has(/\b(billion|trillion|growth\s*rate|growing\s+at)\b/) || has(/\$\s*\d/) || has(/\b\d\s*%\b/)) marketScore += 1;
    if (digits >= 10) marketScore += 1;
    if (marketScore >= 3) tags.push("market_overview");

    let timelineScore = 0;
    if (has(/\b(timeline|milestones?|roadmap|execution\s+plan|phases?|phase\s*\d|go[-\s]?to[-\s]?market\s+plan)\b/)) timelineScore += 2;
    if (has(/\b(q[1-4]\b|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|20\d{2})\b/)) timelineScore += 1;
    if (timelineScore >= 3) tags.push("execution_timeline");

    let capitalStackScore = 0;
    if (has(/\b(capital\s+stack|sources\s*&\s*uses|sources\s+and\s+uses|uses\s+of\s+funds|pro\s*forma|proforma|irr\b|moic\b|multiple\b|return\s+profile)\b/)) capitalStackScore += 2;
    if (fundOrRaiseAnchor) capitalStackScore += 1;
    if (digits >= 16) capitalStackScore += 1;
    if (capitalStackScore >= 3) tags.push("capital_stack");

    let cashflowContractScore = 0;
    if (has(/\b(cash\s*flow|contract(ed)?\s+cash\s*flow|contractual\s+cash\s*flow|revenue\s+contract|offtake\b|purchase\s+agreement)\b/)) cashflowContractScore += 2;
    if (has(/\b(lease|rent|tenant|net\s+lease|nnn\b)\b/)) cashflowContractScore += 1;
    if (digits >= 14) cashflowContractScore += 1;
    if (cashflowContractScore >= 3) tags.push("cashflow_contract");

    let trackRecordScore = 0;
    if (fundOrRaiseAnchor) trackRecordScore += 1;
    if (has(/\b(track\s+record|past\s+performance|portfolio|realized|unrealized|exits?|acquisitions?|distributions?)\b/)) trackRecordScore += 2;
    if (has(/\b(irr\b|tvpi\b|dpi\b|moic\b|multiple\b|net\s+return)\b/)) trackRecordScore += 1;
    if (trackRecordScore >= 3) tags.push("track_record");

    let sponsorScore = 0;
    if (fundOrRaiseAnchor) sponsorScore += 1;
    if (has(/\b(sponsor|operator|team\s+overview|management\s+team|principals?|key\s+person)\b/)) sponsorScore += 2;
    if (sponsorScore >= 3) tags.push("sponsor_overview");

    let tenantOperatorScore = 0;
    if (has(/\b(tenant\s+profile|tenant\s+overview|operator\s+profile|operator\s+overview|operator\s+summary)\b/)) tenantOperatorScore += 2;
    if (realEstateAnchor) tenantOperatorScore += 1;
    if (tenantOperatorScore >= 3) tags.push("tenant_operator_overview");
  }

  // --- Real estate / development tags ---
  if (realEstateAnchor) {
    let sitePlanScore = 0;
    if (has(/\b(site\s*plan|site\s*layout|master\s*plan|parcel\s*plan|plot\s*plan|plat\b|survey\b|aerial\b|vicinity\b|location\s*map)\b/)) sitePlanScore += 2;
    if (has(/\b(utilities|stormwater|drainage|grading|access|circulation|parking|setback|easement|right[-\s]?of[-\s]?way)\b/)) sitePlanScore += 1;

    let entitlementsScore = 0;
    if (has(/\b(zoning|entitlement|entitlements|permitting|permit|planning commission|variance|rezon(ing|e)|eis\b|environmental)\b/)) entitlementsScore += 2;

    let unitProgramScore = 0;
    if (has(/\b(unit\s*mix|program\b|programming\b|floor\s*plan|elevation|stacking|amenities|sq\.?\s*ft|sf\b|gfa\b|units?\b)\b/)) unitProgramScore += 2;

    let scheduleScore = 0;
    if (has(/\b(schedule|timeline|construction|mobilization|groundbreaking|completion|deliver(y|ies)|milestones?)\b/)) scheduleScore += 2;
    if (has(/\b(phase\s*1|phase\s*2|phases?)\b/)) scheduleScore += 1;

    let locationScore = 0;
    if (has(/\b(location\s+thesis|submarket|msa\b|demographics|traffic\s+counts?|drive\s+time|proximity|nearby|radius\b|trade\s+area)\b/)) locationScore += 2;
    if (has(/\b(vicinity|location\s+map|aerial|site\s+location|area\s+map)\b/)) locationScore += 1;

    let sourcesUsesScore = 0;
    if (has(/\b(sources\s*&\s*uses|sources\s+and\s+uses|uses\s+of\s+funds|capital\s+stack|equity\b|debt\b|loan\b|construction\s+loan)\b/)) sourcesUsesScore += 2;
    if (digits >= 16) sourcesUsesScore += 1;

    let leaseTermsScore = 0;
    if (has(/\b(lease\s+terms?|rent\s+roll|tenant\b|occupancy\b|net\s+lease|nnn\b|cam\b|escalations?|rent\s+steps?|lease\s+expiration|remaining\s+term|walt\b)\b/)) leaseTermsScore += 2;
    if (has(/\b(psf\b|sq\.?\s*ft|square\s+feet)\b/)) leaseTermsScore += 1;

    if (sitePlanScore >= 2) tags.push("real_estate_site_plan");
    if (entitlementsScore >= 2) tags.push("real_estate_entitlements_zoning");
    if (unitProgramScore >= 2) tags.push("real_estate_unit_program");
    if (scheduleScore >= 2) tags.push("real_estate_construction_schedule");
    if (locationScore >= 2) tags.push("location_thesis");
    if (sourcesUsesScore >= 3) tags.push("real_estate_sources_uses");
    if (leaseTermsScore >= 3) tags.push("real_estate_lease_terms");
  }

  return uniq(tags);
}
