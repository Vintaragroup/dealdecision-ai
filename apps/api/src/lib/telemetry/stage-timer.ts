import { performance } from 'node:perf_hooks';

export const nowMs = (): number => performance.now();

export type StageTiming = {
  name: string;
  ms: number;
  ok: boolean;
};

export class StageTimer {
  private readonly startedAtMs: number;
  private readonly timings: StageTiming[] = [];

  constructor() {
    this.startedAtMs = nowMs();
  }

  async stage<T>(name: string, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const start = nowMs();
    try {
      const value = await fn();
      const ms = nowMs() - start;
      this.timings.push({ name, ms, ok: true });
      return { value, ms };
    } catch (err) {
      const ms = nowMs() - start;
      this.timings.push({ name, ms, ok: false });
      throw err;
    }
  }

  mark(name: string, ms: number, ok = true): void {
    this.timings.push({ name, ms, ok });
  }

  summary(): {
    total_ms: number;
    stages: StageTiming[];
    stage_ms: Record<string, number>;
  } {
    const total_ms = nowMs() - this.startedAtMs;
    const stage_ms: Record<string, number> = {};
    for (const t of this.timings) {
      stage_ms[t.name] = (stage_ms[t.name] ?? 0) + t.ms;
    }
    return { total_ms, stages: [...this.timings], stage_ms };
  }
}
