export type TeamSignalProfileV1 = {
  founder_count: number;
  key_roles_present: {
    ceo: boolean;
    technical: boolean;
    gtm: boolean;
  };
  prior_startup_experience_present: boolean;
  prior_exit_present: boolean;
  domain_experience_present: boolean;
  team_size_known: boolean;
  confidence: "low" | "medium" | "high";
  signals: Array<{ code: string; present: boolean }>;
};

type StructuredSummaryLike = any;

type PromotedFactLike = any;

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const promotedFactTypeOf = (pf: PromotedFactLike): string => {
  const root = asNonEmptyString(pf?.fact_type);
  if (root) return root;
  const nested = asNonEmptyString(pf?.content_json?.fact_type);
  return nested ?? "";
};

const toRoleText = (member: any): string => {
  if (!member || typeof member !== "object") return "";

  const parts: string[] = [];
  const pushAny = (v: unknown) => {
    if (typeof v === "string") {
      const s = v.trim();
      if (s) parts.push(s);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) pushAny(x);
      return;
    }
  };

  pushAny((member as any).role);
  pushAny((member as any).roles);
  pushAny((member as any).title);
  pushAny((member as any).position);
  pushAny((member as any).job_title);
  pushAny((member as any).jobTitle);

  return parts.join(" ").trim();
};

const includesAny = (text: string, patterns: RegExp[]): boolean => {
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return false;
};

const hasAnyValue = (v: any): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return !!asNonEmptyString(v);
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return false;
};

export function inferTeamSignalProfileV1(input: {
  structured_summary?: any;
  promoted_facts?: any[] | null;
}): TeamSignalProfileV1 {
  const structured: StructuredSummaryLike = input.structured_summary ?? null;
  const promoted = Array.isArray(input.promoted_facts) ? input.promoted_facts : [];

  const team = structured?.team ?? null;
  const members: any[] = Array.isArray(team?.members) ? team.members : [];

  const founderCountFromStructured = members.filter((m) => {
    const roleText = toRoleText(m).toLowerCase();
    if (!roleText) return false;
    return /\b(co[-\s]?founder|cofounder|founder)\b/i.test(roleText);
  }).length;

  const founderFactsCount = promoted.filter((pf) => {
    const ft = promotedFactTypeOf(pf).toLowerCase();
    return ft === "founder_v1" || ft === "cofounder_v1";
  }).length;

  const founder_count = founderCountFromStructured > 0 ? founderCountFromStructured : founderFactsCount;

  const technicalFounderFlag = team?.technical_founder === true || team?.technicalFounder === true;

  const ceoFromMembers = members.some((m) => {
    const t = toRoleText(m);
    if (!t) return false;
    return includesAny(t, [/\bCEO\b/i, /chief\s+executive/i]);
  });

  const technicalFromMembers = members.some((m) => {
    const t = toRoleText(m);
    if (!t) return false;
    return includesAny(t, [/\bCTO\b/i, /engineer/i, /technical/i]);
  });

  const gtmFromMembers = members.some((m) => {
    const t = toRoleText(m);
    if (!t) return false;
    return includesAny(t, [/\bCRO\b/i, /\bCMO\b/i, /sales/i, /growth/i]);
  });

  const key_roles_present = {
    ceo: ceoFromMembers,
    technical: technicalFounderFlag || technicalFromMembers,
    gtm: gtmFromMembers,
  };

  const priorFromStructured = (() => {
    if (!team || typeof team !== "object") return false;

    if (hasAnyValue((team as any).prior_company) || hasAnyValue((team as any).priorCompany)) return true;
    if (hasAnyValue((team as any).prior_companies) || hasAnyValue((team as any).priorCompanies)) return true;

    for (const m of members) {
      if (!m || typeof m !== "object") continue;
      if (hasAnyValue((m as any).prior_company) || hasAnyValue((m as any).priorCompany)) return true;
      if (hasAnyValue((m as any).prior_companies) || hasAnyValue((m as any).priorCompanies)) return true;
    }

    return false;
  })();

  const priorFromFacts = promoted.some((pf) => promotedFactTypeOf(pf).toLowerCase() === "prior_startup_v1");

  const prior_startup_experience_present = priorFromStructured || priorFromFacts;

  const exitFromFacts = promoted.some((pf) => promotedFactTypeOf(pf).toLowerCase() === "exit_v1");
  const exitCount = (typeof team?.exit_count === "number" && Number.isFinite(team.exit_count))
    ? team.exit_count
    : (typeof team?.exitCount === "number" && Number.isFinite(team.exitCount))
      ? team.exitCount
      : null;

  const prior_exit_present = exitFromFacts || (typeof exitCount === "number" && exitCount > 0);

  const domainFromStructured = team?.domain_relevant_experience === true || team?.domainRelevantExperience === true;
  const domainFromFacts = promoted.some((pf) => promotedFactTypeOf(pf).toLowerCase() === "domain_experience_v1");
  const domain_experience_present = domainFromStructured || domainFromFacts;

  const teamSizeFromStructured = hasAnyValue(team?.size ?? team?.team_size ?? team?.teamSize ?? null);
  const teamSizeFromFacts = promoted.some((pf) => promotedFactTypeOf(pf).toLowerCase() === "team_size_v1");
  const team_size_known = teamSizeFromStructured || teamSizeFromFacts;

  const confidence: TeamSignalProfileV1["confidence"] =
    (founder_count >= 2 && (key_roles_present.technical || key_roles_present.gtm))
      ? "high"
      : (founder_count >= 1)
        ? "medium"
        : "low";

  const balanced_team = founder_count >= 2 && key_roles_present.technical && key_roles_present.gtm;

  const signals: TeamSignalProfileV1["signals"] = [
    { code: "no_founder", present: founder_count === 0 },
    { code: "solo_founder", present: founder_count === 1 },
    { code: "balanced_team", present: balanced_team },
    { code: "no_technical_lead", present: !key_roles_present.technical },
    { code: "no_gtm_lead", present: !key_roles_present.gtm },
    { code: "no_prior_experience", present: !prior_startup_experience_present },
    { code: "no_domain_experience", present: !domain_experience_present },
  ];

  return {
    founder_count,
    key_roles_present,
    prior_startup_experience_present,
    prior_exit_present,
    domain_experience_present,
    team_size_known,
    confidence,
    signals,
  };
}
