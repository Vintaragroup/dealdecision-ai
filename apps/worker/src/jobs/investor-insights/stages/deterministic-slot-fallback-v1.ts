/**
 * PR22 — Deterministic Slot Population Fallback (v1)
 *
 * Extracts product, market-ICP, and business-model descriptors from
 * DPU pitch-deck pages using deterministic regex patterns.
 *
 * Design constraints:
 *   - Conservative / high-precision: returns null rather than noise
 *   - Pure function — no DB access, no LLM calls, no side effects
 *   - Only fills Overview slots that are already empty (never overrides
 *     authoritative governed or structured-summary data)
 *   - Activated via DETERMINISTIC_SLOT_FALLBACK_V1=true env flag
 *
 * Output flows into render_package.deterministic_overview_slots and is
 * read by the web as a last-resort fallback for the Overview tab.
 */

import type { DpuPage } from "./stage-2-deterministic.js";
import {
    checkTextCandidateQuality,
    isSpreadsheetFragment,
    isIncoherentText,
} from "../text-candidate-quality-v1.js";

// ─── Output types ────────────────────────────────────────────────────────────

export const FALLBACK_PROVENANCE = "deterministic_fallback_v1" as const;

export interface DeterministicOverviewSlotV1 {
    value: string;
    /** 0–1 confidence score: 0.8=high, 0.6=medium, 0.4=low */
    confidence: number;
    provenance: typeof FALLBACK_PROVENANCE;
    /** Page references used to derive this value. */
    evidence: Array<{
        document_id: string;
        page_index: number;
        snippet: string;
    }>;
    /** Debug metadata: not displayed to end users. */
    debug: {
        matched_patterns: string[];
        scanned_pages: number;
        scanned_chars: number;
    };
}

export interface DeterministicOverviewSlotsV1 {
    product?: DeterministicOverviewSlotV1;
    market?: DeterministicOverviewSlotV1;
    business_model?: DeterministicOverviewSlotV1;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Max chars returned for a snippeted value. */
const MAX_VALUE_CHARS = 200;
const MAX_SNIPPET_CHARS = 160;

/**
 * Collapse excess whitespace produced by OCR normalisation, trim.
 */
function collapse(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

/** True when a page looks like a financial table (dominated by money tokens). */
function isFinancialPage(text: string): boolean {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words === 0) return false;
    const moneyTokens = (text.match(/\$[\d,]/g) ?? []).length;
    return moneyTokens / words >= 0.10;
}

// ─── Business-model extractor ──────────────────────────────────────────────

/**
 * Known SaaS / revenue-model labels that commonly appear verbatim in pitch decks.
 * Ordered from most specific to least specific so the first hit is the best label.
 *
 * Capture group 0 is the full match — used as the label value.
 */
const BM_LABEL_RE =
    /\b(b2b2c|b2b\s+saas|b2c\s+saas|b2b|b2c|two[- ]sided\s+marketplace|marketplace|saas|paas|usage[- ]based(?:\s+pricing)?|per[- ]seat(?:\s+pricing)?|subscription[- ]based(?:\s+model)?|subscription\s+model|subscription|freemium|transactional(?:\s+model)?|revenue[- ]share|platform\s+fee|licensing\s+model|licensing|enterprise\s+saas|consumption[- ]based)\b/gi;

/**
 * Window for contextual BM classification: "we are a [label]", "[company] is a [label]",
 * "our business model is [phrase]", "business model: [phrase]".
 * Capture group 1 = the descriptor phrase (up to 80 chars).
 */
const BM_CONTEXT_RE =
    /\b(?:we\s+are\s+a|we're\s+a|(?:business\s+model|revenue\s+model)\s*[:—–]\s*)([A-Za-z0-9 ,\/\-_&]{3,80}?)(?=[.\n!?]|$)/i;

/**
 * Resolve a business-model fallback slot from pitch-deck DPU pages.
 *
 * Strategy:
 *   1. Collect BM label hits via BM_LABEL_RE across non-financial pages.
 *   2. Optionally validate that a "business model: …" context phrase uses the
 *      same labels (boosts confidence).
 *   3. Return the top-2 distinct labels as the value (e.g. "B2B SaaS, marketplace").
 *   4. Return null when fewer than 1 label is found.
 */
export function resolveBusinessModelFallbackV1(
    dpuPages: DpuPage[]
): DeterministicOverviewSlotV1 | null {
    const labelCounts = new Map<string, number>();
    const evidence: DeterministicOverviewSlotV1["evidence"] = [];
    let scannedPages = 0;
    let scannedChars = 0;
    const matchedPatterns: string[] = [];

    for (const page of dpuPages) {
        const text = page.text ?? "";
        if (!text || text.length < 20) continue;
        if (isFinancialPage(text)) continue;

        scannedPages++;
        scannedChars += text.length;

        let pageHit = false;
        let pageSnippet = "";
        const labelMatches = [...text.matchAll(BM_LABEL_RE)];
        for (const m of labelMatches) {
            const raw = m[1] ?? m[0];
            const label = collapse(raw).toLowerCase().replace(/\s+/g, " ");
            // Normalise: collapse whitespace, lowercase for dedup
            const normalised = label;
            labelCounts.set(normalised, (labelCounts.get(normalised) ?? 0) + 1);
            if (!pageHit) {
                pageHit = true;
                pageSnippet = collapse(text.slice(0, MAX_SNIPPET_CHARS));
                matchedPatterns.push("BM_LABEL_RE");
            }
        }

        // Also scan for context phrases to add more evidence
        const ctxMatch = BM_CONTEXT_RE.exec(text);
        if (ctxMatch) {
            const ctxLabel = collapse(ctxMatch[1] ?? "").toLowerCase();
            if (ctxLabel.length >= 3 && ctxLabel.length <= 80) {
                labelCounts.set(ctxLabel, (labelCounts.get(ctxLabel) ?? 0) + 1);
                if (!pageHit) {
                    pageHit = true;
                    pageSnippet = collapse(text.slice(0, MAX_SNIPPET_CHARS));
                    matchedPatterns.push("BM_CONTEXT_RE");
                }
            }
        }

        if (pageHit && evidence.length < 3) {
            evidence.push({
                document_id: page.document_id,
                page_index: page.page_index,
                snippet: pageSnippet,
            });
        }
    }

    if (labelCounts.size === 0) return null;

    // Sort by frequency desc, then alphabetically for determinism
    const ranked = [...labelCounts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
    });

    // Prefer specific compound labels (longer = more specific) when frequency is equal
    const top2 = ranked.slice(0, 2).map(([label]) => {
        // Title-case for display
        return label.replace(/\b(\w)/g, (c) => c.toUpperCase());
    });

    const value = collapse(top2.join(", ")).slice(0, MAX_VALUE_CHARS);
    if (!value) return null;

    // Confidence: high (0.8) if top label seen ≥2 pages; medium (0.6) if 1 page
    const topFreq = ranked[0]?.[1] ?? 0;
    const confidence = topFreq >= 2 ? 0.8 : 0.6;

    return {
        value,
        confidence,
        provenance: FALLBACK_PROVENANCE,
        evidence,
        debug: {
            matched_patterns: [...new Set(matchedPatterns)],
            scanned_pages: scannedPages,
            scanned_chars: scannedChars,
        },
    };
}

// ─── Product extractor ─────────────────────────────────────────────────────

/**
 * Sentence-starting patterns that reveal product identity.
 * Capture group 1 = the sentence body (up to 200 chars, before sentence end).
 *
 * Form P1: "We [active_verb] …"
 * Form P2: "Our [product_noun] [verb] …"
 */
const PRODUCT_SENTENCE_RE =
    /(?:^|[.\n]\s{0,4})(We\s+(?:are|build|create|develop|provide|offer|enable|help|power|serve|deliver|make)\b[^.\n]{10,190}\.?)/im;

const PRODUCT_NOUN_RE =
    /(?:^|[.\n]\s{0,4})(Our\s+(?:platform|product|solution|technology|tool|software|service|system|app(?:lication)?|api)\b[^.\n]{10,190}\.?)/im;

/**
 * Resolve a product-description fallback slot from pitch-deck DPU pages.
 *
 * Strategy:
 *   1. Scan non-financial pages for "We [verb]…" or "Our [product]…" sentences.
 *   2. Prefer the shortest clean sentence (least OCR noise risk).
 *   3. Return null when no qualifying sentence found.
 */
export function resolveProductFallbackV1(
    dpuPages: DpuPage[]
): DeterministicOverviewSlotV1 | null {
    /** Candidates collected across all pages: [pageScore, value, evidence_entry] */
    const candidates: Array<{
        value: string;
        score: number;
        entry: DeterministicOverviewSlotV1["evidence"][number];
        pattern: string;
    }> = [];

    let scannedPages = 0;
    let scannedChars = 0;

    for (const page of dpuPages) {
        const text = page.text ?? "";
        if (!text || text.length < 30) continue;
        if (isFinancialPage(text)) continue;

        scannedPages++;
        scannedChars += text.length;

        const tryMatch = (re: RegExp, patternName: string) => {
            const m = re.exec(text);
            if (!m) return;
            const raw = m[1] ?? m[0];
            const value = collapse(raw).replace(/\.$/, "").slice(0, MAX_VALUE_CHARS);
            if (value.length < 20) return; // too short to be useful
            // PR36.5: quality gate — reject spreadsheet fragments, OCR continuations, incoherent text
            const qg = checkTextCandidateQuality(value);
            if (!qg.accept) return;
            // Penalise very long values (likely OCR run-ons)
            const score = value.length <= 120 ? 1.0 : 0.5;
            candidates.push({
                value,
                score,
                entry: {
                    document_id: page.document_id,
                    page_index: page.page_index,
                    snippet: collapse(text.slice(0, MAX_SNIPPET_CHARS)),
                },
                pattern: patternName,
            });
        };

        tryMatch(PRODUCT_SENTENCE_RE, "PRODUCT_SENTENCE_RE");
        tryMatch(PRODUCT_NOUN_RE, "PRODUCT_NOUN_RE");
    }

    if (candidates.length === 0) return null;

    // Pick best: highest score, then shortest value (least noisy)
    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.value.length - b.value.length;
    });

    const best = candidates[0]!;
    const matchedPatterns = [...new Set(candidates.map((c) => c.pattern))];

    // Confidence: high(0.8) if ≥2 matching pages, medium(0.6) if 1
    const confidence = candidates.length >= 2 ? 0.8 : 0.6;

    return {
        value: best.value,
        confidence,
        provenance: FALLBACK_PROVENANCE,
        evidence: candidates.slice(0, 3).map((c) => c.entry),
        debug: {
            matched_patterns: matchedPatterns,
            scanned_pages: scannedPages,
            scanned_chars: scannedChars,
        },
    };
}

// ─── Market / ICP extractor ────────────────────────────────────────────────

/**
 * ICP phrase patterns — targeting/serving/for expressions.
 * Capture group 1 = the ICP descriptor phrase (up to 120 chars).
 *
 * Form M1: "targeting [segment]"
 * Form M2: "for [segment] [customers|companies|businesses|…]"
 * Form M3: "serving [segment]"
 * Form M4: "designed for / built for [segment]"
 */
const MARKET_ICP_INLINE_RE =
    /\b(?:target(?:ing|s)?\s+|(?:designed|built|made|created)\s+for\s+|serving\s+|focused\s+on\s+)([A-Za-z][A-Za-z0-9 ,\/\-_&']{5,120}?)(?=[.\n!?]|$)/i;

/**
 * Explicit ICP sentence: "our target (?:customer|market|segment) (?:is|are) …"
 */
const MARKET_TARGET_RE =
    /\b(?:our\s+)?target\s+(?:customers?|market|audience|segment|users?)\s+(?:is|are|includes?)\s+([A-Za-z][^.\n]{5,120}?)(?=[.\n!?]|$)/i;

/** Known ICP segment keywords that increase confidence. */
const ICP_SEGMENT_RE =
    /\b(?:SMB|SME|mid[- ]market|enterprise|Fortune\s*\d+|startup|consumer|developer|healthcare|financial\s+services?|retail|e[- ]commerce|logistics|real\s+estate|insurance|legal|education|hospitality|SaaS\s+compan(?:y|ies))\b/i;

/**
 * Resolve a market/ICP fallback slot from pitch-deck DPU pages.
 *
 * Strategy:
 *   1. Scan non-financial pages for explicit ICP phrases.
 *   2. Prefer pages that also contain a known ICP segment keyword.
 *   3. Return null when no qualifying phrase found.
 */
export function resolveMarketFallbackV1(
    dpuPages: DpuPage[]
): DeterministicOverviewSlotV1 | null {
    const candidates: Array<{
        value: string;
        score: number;
        entry: DeterministicOverviewSlotV1["evidence"][number];
        pattern: string;
    }> = [];

    let scannedPages = 0;
    let scannedChars = 0;

    for (const page of dpuPages) {
        const text = page.text ?? "";
        if (!text || text.length < 20) continue;
        if (isFinancialPage(text)) continue;

        scannedPages++;
        scannedChars += text.length;

        const hasKnownSegment = ICP_SEGMENT_RE.test(text);

        const tryMatch = (re: RegExp, patternName: string, baseScore: number) => {
            const m = re.exec(text);
            if (!m) return;
            const raw = m[1] ?? m[0];
            const value = collapse(raw).replace(/\.$/, "").slice(0, MAX_VALUE_CHARS);
            if (value.length < 8) return; // too short
            // PR36.5: quality gate — reject spreadsheet fragments and incoherent text.
            // Note: OCR continuation check is intentionally SKIPPED here — ICP phrases
            // extracted by pattern groups naturally start lowercase (e.g. "mid-market
            // healthcare companies...") and must not be rejected as continuation fragments.
            if (isSpreadsheetFragment(value) || isIncoherentText(value)) return;
            const score = baseScore + (hasKnownSegment ? 0.2 : 0);
            candidates.push({
                value,
                score,
                entry: {
                    document_id: page.document_id,
                    page_index: page.page_index,
                    snippet: collapse(text.slice(0, MAX_SNIPPET_CHARS)),
                },
                pattern: patternName,
            });
        };

        tryMatch(MARKET_TARGET_RE, "MARKET_TARGET_RE", 1.0);
        tryMatch(MARKET_ICP_INLINE_RE, "MARKET_ICP_INLINE_RE", 0.8);
    }

    if (candidates.length === 0) return null;

    // De-duplicate by value similarity (same first 40 chars)
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
        const key = c.value.slice(0, 40).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    deduped.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.value.length - b.value.length;
    });

    const best = deduped[0]!;
    const matchedPatterns = [...new Set(deduped.map((c) => c.pattern))];
    const confidence = deduped.length >= 2 ? 0.8 : 0.6;

    return {
        value: best.value,
        confidence,
        provenance: FALLBACK_PROVENANCE,
        evidence: deduped.slice(0, 3).map((c) => c.entry),
        debug: {
            matched_patterns: matchedPatterns,
            scanned_pages: scannedPages,
            scanned_chars: scannedChars,
        },
    };
}

// ─── Top-level resolver ────────────────────────────────────────────────────

/**
 * Resolve all three Overview fallback slots in a single pass.
 *
 * Returns only the slots that produced a result; fields absent when no
 * qualifying evidence was found.
 *
 * Callers should check `DETERMINISTIC_SLOT_FALLBACK_V1=true` before calling
 * this function (the processor does this gate before invoking the resolver).
 */
export function resolveOverviewFallbacksV1(
    dpuPages: DpuPage[]
): DeterministicOverviewSlotsV1 {
    const out: DeterministicOverviewSlotsV1 = {};

    const product = resolveProductFallbackV1(dpuPages);
    if (product) out.product = product;

    const market = resolveMarketFallbackV1(dpuPages);
    if (market) out.market = market;

    const businessModel = resolveBusinessModelFallbackV1(dpuPages);
    if (businessModel) out.business_model = businessModel;

    return out;
}
