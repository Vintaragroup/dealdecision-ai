/**
 * Intelligence Layer — Lightweight Metrics Counters
 *
 * Provides a process-level in-memory counter/timer abstraction for Stage 5.
 * No external metrics system required; values are emitted via structured logs
 * at interval and on-demand so they can be scraped by any log-based metrics pipeline.
 *
 * Future integration point: swap `emit()` for a Prometheus/StatsD/OpenTelemetry
 * push when a metrics system is available.
 *
 * Usage:
 *   intelligenceMetrics.increment("stage5.run");
 *   intelligenceMetrics.increment("stage5.success");
 *   intelligenceMetrics.timing("stage5.duration_ms", elapsed);
 *   intelligenceMetrics.snapshot(); // returns current counter snapshot
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntelligenceMetricSnapshot {
  // Stage 5 lifecycle
  stage5_runs: number;
  stage5_successes: number;
  stage5_failures: number;
  stage5_skipped: number;           // feature flag off
  stage5_shadow_runs: number;       // rollout mode=shadow
  stage5_persist_only_runs: number; // rollout mode=persist_only

  // Sub-system outcomes
  memory_writes: number;
  memory_write_failures: number;
  evaluator_runs: number;
  evaluator_flag_critical: number;
  evaluator_flag_error: number;
  evaluator_flag_warn: number;
  evaluator_flag_info: number;
  confidence_runs: number;
  confidence_low_count: number;     // band = Low
  confidence_medium_count: number;  // band = Medium
  confidence_high_count: number;    // band = High
  challenge_pass_runs: number;
  challenge_pass_fragile: number;   // resistance_label = Fragile or Very Fragile
  persistence_write_failures: number;

  // Timing (nanoseconds internally, reported as ms)
  stage5_total_duration_ms: number;
  stage5_run_count_for_avg: number;
}

// ─── In-memory counter store ──────────────────────────────────────────────────

const counters: IntelligenceMetricSnapshot = {
  stage5_runs: 0,
  stage5_successes: 0,
  stage5_failures: 0,
  stage5_skipped: 0,
  stage5_shadow_runs: 0,
  stage5_persist_only_runs: 0,
  memory_writes: 0,
  memory_write_failures: 0,
  evaluator_runs: 0,
  evaluator_flag_critical: 0,
  evaluator_flag_error: 0,
  evaluator_flag_warn: 0,
  evaluator_flag_info: 0,
  confidence_runs: 0,
  confidence_low_count: 0,
  confidence_medium_count: 0,
  confidence_high_count: 0,
  challenge_pass_runs: 0,
  challenge_pass_fragile: 0,
  persistence_write_failures: 0,
  stage5_total_duration_ms: 0,
  stage5_run_count_for_avg: 0,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const intelligenceMetrics = {
  /**
   * Increment a named counter by 1 (or a custom delta).
   */
  increment(key: keyof IntelligenceMetricSnapshot, delta = 1): void {
    counters[key] = (counters[key] as number) + delta;
  },

  /**
   * Record a duration (ms). Accumulates into avg_duration calculation.
   */
  timing(key: "stage5.duration_ms", ms: number): void {
    counters.stage5_total_duration_ms += ms;
    counters.stage5_run_count_for_avg += 1;
  },

  /**
   * Return a frozen copy of current counters plus derived averages.
   */
  snapshot(): IntelligenceMetricSnapshot & { stage5_avg_duration_ms: number } {
    const avg =
      counters.stage5_run_count_for_avg > 0
        ? counters.stage5_total_duration_ms / counters.stage5_run_count_for_avg
        : 0;
    return { ...counters, stage5_avg_duration_ms: avg };
  },

  /**
   * Emit current metrics as a structured log event.
   * Call this periodically or after every N runs for log-based scraping.
   */
  emitSnapshot(): void {
    const snap = intelligenceMetrics.snapshot();
    console.log(
      JSON.stringify({
        event: "intelligence.metrics.snapshot",
        metrics: snap,
        ts: new Date().toISOString(),
      })
    );
  },

  /**
   * Reset all counters. Intended for tests only.
   */
  _reset(): void {
    (Object.keys(counters) as Array<keyof IntelligenceMetricSnapshot>).forEach((k) => {
      counters[k] = 0;
    });
  },
};
