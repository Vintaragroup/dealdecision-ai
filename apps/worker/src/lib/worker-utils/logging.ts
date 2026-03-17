/**
 * Worker dev-logging utilities.
 *
 * `makeDevLogger` creates a structured JSON logger that is silenced in
 * production unless `DEBUG_WORKER_LOGS=1` is set.
 */

export const devLogEnabled =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_WORKER_LOGS === "1";

/**
 * Returns a `devLog(event, payload)` function.
 *
 * @param enabled - Defaults to {@link devLogEnabled}. Pass an explicit boolean
 *   in tests to control output without touching env vars.
 */
export function makeDevLogger(enabled = devLogEnabled) {
  return (event: string, payload: Record<string, unknown>): void => {
    if (!enabled) return;
    try {
      console.log(JSON.stringify({ event, ...payload }));
    } catch (err) {
      console.warn(
        `[devLog] failed to stringify event=${event}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
}
