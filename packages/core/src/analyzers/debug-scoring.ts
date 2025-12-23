import type { DebugScoringTrace } from "../types/dio";

type Rule = NonNullable<DebugScoringTrace["rules"]>[number];

type Item = NonNullable<DebugScoringTrace["signals"]>[number];

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function buildRulesFromBaseAndDeltas(params: {
  base: number;
  base_rule_id?: string;
  base_description?: string;
  penalties?: Array<{ rule_id: string; description: string; points: number }>;
  bonuses?: Array<{ rule_id: string; description: string; points: number }>;
  final_score: number | null;
  clamp_range?: { min: number; max: number };
}): Rule[] {
  const rules: Rule[] = [];
  const baseRuleId = params.base_rule_id ?? "base";
  const baseDesc = params.base_description ?? "Base score";

  let running = params.base;
  rules.push({ rule_id: baseRuleId, description: baseDesc, delta: params.base, running_total: running });

  const bonuses = params.bonuses ?? [];
  for (const b of bonuses) {
    const delta = isFiniteNumber(b.points) ? b.points : 0;
    running += delta;
    rules.push({ rule_id: b.rule_id, description: b.description, delta, running_total: running });
  }

  const penalties = params.penalties ?? [];
  for (const p of penalties) {
    const delta = isFiniteNumber(p.points) ? -Math.abs(p.points) : 0;
    running += delta;
    rules.push({ rule_id: p.rule_id, description: p.description, delta, running_total: running });
  }

  if (params.final_score == null) {
    return rules;
  }

  let final = params.final_score;
  if (params.clamp_range) {
    final = Math.min(params.clamp_range.max, Math.max(params.clamp_range.min, final));
  }

  const deltaToFinal = final - running;
  if (Math.abs(deltaToFinal) > 1e-9) {
    running = final;
    rules.push({
      rule_id: "final_adjust",
      description: "Final adjustment (rounding/clamp)",
      delta: deltaToFinal,
      running_total: running,
    });
  }

  return rules;
}

export function legacyItemsToRuleDeltas(items: Item[], prefix: string): Array<{ rule_id: string; description: string; points: number }> {
  return (items || []).map((it, idx) => {
    const key = typeof (it as any)?.key === "string" ? (it as any).key : `item_${idx}`;
    const points = isFiniteNumber((it as any)?.points) ? (it as any).points : 0;
    const note = typeof (it as any)?.note === "string" && (it as any).note.trim().length > 0 ? `: ${(it as any).note.trim()}` : "";
    return {
      rule_id: `${prefix}:${key}`,
      description: `${key}${note}`,
      points,
    };
  });
}
