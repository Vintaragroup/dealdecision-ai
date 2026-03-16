/**
 * First-Pass Latency Reduction — Phase 1 Constants
 *
 * These constants govern the "first-pass" window: the subset of pages / time budget
 * that is treated as the critical path for getting an initial analysis in front of the
 * user as quickly as possible.
 *
 * Critical-path pages (index 0 … FIRST_PASS_PAGE_THRESHOLD-1):
 *   - Use shorter vision timeouts so slow/failing pages don't block the first pass.
 *   - Chunk jobs for these pages receive higher BullMQ priority.
 *
 * Background pages (index ≥ FIRST_PASS_PAGE_THRESHOLD):
 *   - Use the original, more generous timeouts that give the vision worker more time.
 *   - Lower BullMQ priority so first-pass slots are processed first.
 */

/** Pages below this index are on the "critical path" for first-pass analysis. */
export const FIRST_PASS_PAGE_THRESHOLD = 10;

/**
 * Vision attempt timeouts for first-pass (critical-path) pages.
 * Shorter than the background defaults to fail-fast on genuinely unavailable pages.
 * PDF: two attempts at 12 s and 30 s → worst-case ~43 s per failing page
 *       (vs the background default of ~81 s with [20 k, 60 k]).
 */
export const FIRST_PASS_VISION_TIMEOUTS_PDF = [12_000, 30_000] as const;

/**
 * Vision attempt timeouts for first-pass PowerPoint pages.
 * Three attempts at 12 s / 30 s / 60 s → worst-case ~103 s per failing page
 * (vs the background default of ~173 s with [20 k, 60 k, 90 k]).
 */
export const FIRST_PASS_VISION_TIMEOUTS_PPTX = [12_000, 30_000, 60_000] as const;

/** BullMQ job priority for first-chunk (pages 0–N-1) extract_visuals jobs (lower = higher priority). */
export const FIRST_PASS_CHUNK_PRIORITY = 1;

/** BullMQ job priority for background (pages N+) extract_visuals chunk jobs. */
export const BACKGROUND_CHUNK_PRIORITY = 5;
