/**
 * Analysis Foundation Spec Version (Fundability System)
 *
 * Authoritative source: docs/Active/Authoritative/analysis-foundation/
 */

export const analysis_foundation_spec_version = "1.0.0" as const;

export function isFundabilityShadowModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FUNDABILITY_SHADOW_MODE;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isFundabilitySoftCapsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FUNDABILITY_SOFT_CAPS;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isFundabilityHardGatesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FUNDABILITY_HARD_GATES;
  return raw === "1" || raw === "true" || raw === "yes";
}
