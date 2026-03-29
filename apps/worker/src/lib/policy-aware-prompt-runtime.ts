import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";

export type PolicyPromptArtifactId =
  | "system_audit_prompt_pack_v1"
  | "scoring_normalization_rubric_v1"
  | "policy_aware_prompt_pack_v2"
  | "policy_aware_output_template_v2";

type ArtifactSpec = {
  id: PolicyPromptArtifactId;
  fileName: string;
  requiredVersion: string;
};

export type LoadedPolicyPromptArtifact = {
  id: PolicyPromptArtifactId;
  fileName: string;
  version: string;
  sha256: string;
  content: string;
  sections: Array<{ title: string; body: string }>;
};

export type PolicyPromptRuntimePacket = {
  loaded_at: string;
  artifacts: Record<PolicyPromptArtifactId, LoadedPolicyPromptArtifact>;
};

export type PolicyPromptRequirements = {
  policy_id: string;
  required_metrics: string[];
  not_applicable_metrics: string[];
  section_mapping: Record<string, string>;
};

export type PolicyAwareOutputTemplateValidation = {
  kind: "deal_summary_v2" | "display_facts_v1" | "governed_ui_copy_v1";
  policy_id: string;
  ok: boolean;
  degraded: boolean;
  missing_sections: string[];
  policy_mapping_valid: boolean;
  warnings: string[];
};

const ARTIFACT_SPECS: ArtifactSpec[] = [
  {
    id: "system_audit_prompt_pack_v1",
    fileName: "DealDecision-System-Audit-Prompt-Pack-v1.md",
    requiredVersion: "v1",
  },
  {
    id: "scoring_normalization_rubric_v1",
    fileName: "DealDecision-Scoring-Normalization-Rubric-v1.md",
    requiredVersion: "v1",
  },
  {
    id: "policy_aware_prompt_pack_v2",
    fileName: "DealDecision-Policy-Aware-Prompt-Pack-v2.md",
    requiredVersion: "v2",
  },
  {
    id: "policy_aware_output_template_v2",
    fileName: "DealDecision-Policy-Aware-Output-Template-v2.md",
    requiredVersion: "v2",
  },
];

let cachedRuntimePacket: PolicyPromptRuntimePacket | null = null;

function parseSections(markdown: string): Array<{ title: string; body: string }> {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = "_preamble";
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join("\n").trim();
    sections.push({ title: currentTitle, body });
    currentBody = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      currentTitle = m[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      continue;
    }
    currentBody.push(line);
  }
  flush();

  return sections.filter((s) => s.body.length > 0);
}

function parseVersionFromFileName(fileName: string): string | null {
  const m = /-(v\d+)\.md$/i.exec(fileName);
  return m ? m[1].toLowerCase() : null;
}

function computeSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function loadPolicyPromptRuntimePacket(opts?: { forceReload?: boolean }): PolicyPromptRuntimePacket {
  if (cachedRuntimePacket && opts?.forceReload !== true) return cachedRuntimePacket;

  const findArtifactsDir = (): string => {
    const start = process.cwd();
    const probes = [
      start,
      path.resolve(start, ".."),
      path.resolve(start, "../.."),
      path.resolve(start, "../../.."),
      path.resolve(start, "../../../.."),
    ];
    for (const p of probes) {
      const candidate = path.join(p, "artifacts");
      if (existsSync(candidate)) return candidate;
    }
    return path.resolve(start, "artifacts");
  };

  const artifactsDir = findArtifactsDir();

  const artifacts = {} as Record<PolicyPromptArtifactId, LoadedPolicyPromptArtifact>;
  for (const spec of ARTIFACT_SPECS) {
    const filePath = path.join(artifactsDir, spec.fileName);
    let content = "";
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`policy_prompt_artifact_missing:${spec.fileName}:${msg}`);
    }

    const version = parseVersionFromFileName(spec.fileName);
    if (!version || version !== spec.requiredVersion) {
      throw new Error(
        `policy_prompt_artifact_version_mismatch:${spec.fileName}:expected=${spec.requiredVersion}:actual=${version ?? "unknown"}`
      );
    }

    const sha256 = computeSha256(content);
    const sections = parseSections(content);
    artifacts[spec.id] = {
      id: spec.id,
      fileName: spec.fileName,
      version,
      sha256,
      content,
      sections,
    };
  }

  const packet: PolicyPromptRuntimePacket = {
    loaded_at: new Date().toISOString(),
    artifacts,
  };

  try {
    console.log(
      JSON.stringify({
        event: "POLICY_PROMPT_ARTIFACTS_LOADED",
        loaded_at: packet.loaded_at,
        artifacts: ARTIFACT_SPECS.map((s) => ({
          id: s.id,
          file: packet.artifacts[s.id].fileName,
          version: packet.artifacts[s.id].version,
          sha256: packet.artifacts[s.id].sha256,
          sections: packet.artifacts[s.id].sections.length,
        })),
      })
    );
  } catch {
    // ignore logging failures
  }

  cachedRuntimePacket = packet;
  return packet;
}

export function getPolicyPromptRequirements(policyId: string | null | undefined): PolicyPromptRequirements {
  const p = typeof policyId === "string" && policyId.trim().length > 0 ? policyId.trim() : "unknown_generic";

  if (p === "real_estate_underwriting") {
    return {
      policy_id: p,
      required_metrics: ["noi", "cap_rate", "occupancy", "debt_service_coverage"],
      not_applicable_metrics: ["cac", "nrr", "mau", "icp_payback"],
      section_mapping: {
        market_icp: "asset_class_and_tenant_profile",
        business_model: "rent_roll_and_yield_model",
      },
    };
  }

  if (p === "operating_startup_revenue_v1" || p === "execution_ready_v1") {
    return {
      policy_id: p,
      required_metrics: ["icp", "cac", "ltv", "payback_period", "revenue_growth"],
      not_applicable_metrics: ["noi", "cap_rate", "occupancy"],
      section_mapping: {
        market_icp: "customer_segment_and_gtm",
        business_model: "unit_economics_and_pricing",
      },
    };
  }

  return {
    policy_id: p,
    required_metrics: ["revenue", "risk", "evidence_coverage"],
    not_applicable_metrics: [],
    section_mapping: {
      market_icp: "market_icp",
      business_model: "business_model",
    },
  };
}

function buildArtifactContext(packet: PolicyPromptRuntimePacket): string {
  const order: PolicyPromptArtifactId[] = [
    "system_audit_prompt_pack_v1",
    "scoring_normalization_rubric_v1",
    "policy_aware_prompt_pack_v2",
    "policy_aware_output_template_v2",
  ];
  const lines: string[] = [];
  for (const id of order) {
    const a = packet.artifacts[id];
    const sectionPreview = a.sections
      .slice(0, 5)
      .map((s) => s.title)
      .join(", ");
    lines.push(
      `Artifact ${a.fileName} (${a.version}, sha256=${a.sha256}) sections=${sectionPreview || "none"}`
    );
  }
  return lines.join("\n");
}

export function composePolicyAwareSystemPrompt(args: {
  kind: "deal_summary_v2" | "display_facts_v1" | "governed_ui_copy_v1";
  selectedPolicyId: string | null | undefined;
  additionalInstructions?: string[];
}): {
  systemPrompt: string;
  runtimeMetadata: {
    selected_policy_id: string;
    prompt_artifacts: Array<{ id: PolicyPromptArtifactId; file: string; version: string; sha256: string }>;
    template_version: string;
    policy_requirements: PolicyPromptRequirements;
  };
} {
  const packet = loadPolicyPromptRuntimePacket();
  const req = getPolicyPromptRequirements(args.selectedPolicyId);

  const promptArtifacts = ARTIFACT_SPECS.map((s) => ({
    id: s.id,
    file: packet.artifacts[s.id].fileName,
    version: packet.artifacts[s.id].version,
    sha256: packet.artifacts[s.id].sha256,
  }));

  const base = [
    "You are a policy-aware deal analyst. You must follow the loaded runtime artifacts exactly.",
    "Do not independently classify the deal. The selected_policy_id is canonical and already determined by the deterministic classification system.",
    `selected_policy_id=${req.policy_id}`,
    `required_metrics=${req.required_metrics.join(",") || "none"}`,
    `not_applicable_metrics=${req.not_applicable_metrics.join(",") || "none"}`,
    `section_mapping=${JSON.stringify(req.section_mapping)}`,
    "If required policy metrics are not evidenced, explicitly mark them as missing evidence.",
    "Never treat not_applicable_metrics as required for this deal policy.",
    "Output must remain strictly within the requested JSON schema for this call kind.",
    `call_kind=${args.kind}`,
    "Runtime artifact manifest:\n" + buildArtifactContext(packet),
  ];

  if (Array.isArray(args.additionalInstructions) && args.additionalInstructions.length > 0) {
    for (const line of args.additionalInstructions) {
      const s = String(line ?? "").trim();
      if (!s) continue;
      base.push(s);
    }
  }

  return {
    systemPrompt: base.join("\n"),
    runtimeMetadata: {
      selected_policy_id: req.policy_id,
      prompt_artifacts: promptArtifacts,
      template_version: packet.artifacts.policy_aware_output_template_v2.version,
      policy_requirements: req,
    },
  };
}

export function validatePolicyAwareOutputTemplateV2(args: {
  kind: "deal_summary_v2" | "display_facts_v1" | "governed_ui_copy_v1";
  selectedPolicyId: string | null | undefined;
  output: Record<string, unknown> | null;
}): PolicyAwareOutputTemplateValidation {
  const req = getPolicyPromptRequirements(args.selectedPolicyId);
  const missing: string[] = [];
  const warnings: string[] = [];
  const output = args.output && typeof args.output === "object" ? args.output : null;

  const requiredKeysByKind: Record<string, string[]> = {
    deal_summary_v2: ["summary", "strengths", "risks", "open_questions"],
    display_facts_v1: ["product_solution", "market_icp", "business_model", "raise_terms"],
    governed_ui_copy_v1: ["hero_summary", "product_solution", "market_icp", "business_model", "raise_terms"],
  };

  const required = requiredKeysByKind[args.kind] ?? [];
  for (const key of required) {
    if (!output || !(key in output)) missing.push(key);
  }

  let policyMappingValid = true;
  if (!output) {
    policyMappingValid = false;
  } else {
    if (req.policy_id === "real_estate_underwriting") {
      const collectStrings = (v: unknown, acc: string[]) => {
        if (typeof v === "string") {
          const s = v.trim();
          if (s) acc.push(s);
          return;
        }
        if (Array.isArray(v)) {
          for (const x of v) collectStrings(x, acc);
          return;
        }
        if (v && typeof v === "object") {
          for (const x of Object.values(v as Record<string, unknown>)) collectStrings(x, acc);
        }
      };
      const fragments: string[] = [];
      collectStrings(output, fragments);
      const textHaystack = fragments.join(" \n").toLowerCase();
      if (textHaystack.includes("cac") || textHaystack.includes("customer acquisition cost")) {
        warnings.push("real_estate_contains_startup_metric_cac");
      }
      if (textHaystack.includes("icp") || textHaystack.includes("ideal customer profile")) {
        warnings.push("real_estate_contains_startup_metric_icp");
      }
      if (warnings.length > 0) policyMappingValid = false;
    }
  }

  const ok = missing.length === 0 && policyMappingValid;
  const degraded = !ok;

  return {
    kind: args.kind,
    policy_id: req.policy_id,
    ok,
    degraded,
    missing_sections: missing,
    policy_mapping_valid: policyMappingValid,
    warnings,
  };
}

export function getSelectedPolicyIdFromAnyLike(input: any): string | null {
  const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const candidates: unknown[] = [
    input?.dio?.deal_classification_v1?.selected_policy,
    input?.deal_classification_v1?.selected_policy,
    input?.dio?.dio?.deal_classification_v1?.selected_policy,
    input?.phase1?.deal_classification_v1?.selected_policy,
    input?.dio?.phase1?.deal_classification_v1?.selected_policy,
    input?.selected_policy,
    input?.policy_id,
  ];

  for (const c of candidates) {
    if (isNonEmptyString(c)) return c.trim();
  }

  try {
    const stack: any[] = [input];
    const seen = new Set<any>();
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);
      const p = (cur as any)?.deal_classification_v1?.selected_policy;
      if (isNonEmptyString(p)) return p.trim();
      for (const k of Object.keys(cur)) {
        const child = (cur as any)[k];
        if (child && typeof child === "object") stack.push(child);
      }
    }
  } catch {
    // ignore
  }

  return null;
}
