/**
 * Generic async retry with exponential back-off.
 *
 * @example
 * ```ts
 * const result = await retryWithBackoff(() => callExternalApi(), {
 *   maxAttempts: 4,
 *   initialDelayMs: 250,
 * });
 * ```
 */

export interface RetryOptions {
  /** Total number of attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Delay before the second attempt (ms). Default: 500. */
  initialDelayMs?: number;
  /** Multiplier applied to the delay after each failure. Default: 2. */
  backoffFactor?: number;
  /** Upper bound on the computed delay (ms). Default: 30 000. */
  maxDelayMs?: number;
  /**
   * Called after each failed attempt (except the last) before sleeping.
   * Useful for logging or metric instrumentation.
   */
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    backoffFactor = 2,
    maxDelayMs = 30_000,
    onRetry,
  } = options;

  let lastErr: unknown;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      onRetry?.(attempt, err);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * backoffFactor, maxDelayMs);
    }
  }

  throw lastErr;
}
