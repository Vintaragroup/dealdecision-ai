/**
 * Canonical Company Identity Resolver — Schema
 *
 * Types describing the output of resolveCanonicalIdentity().
 * The resolver is deterministic/heuristic — no LLM calls.
 */

// ─── Evidence sources (in order of weight) ────────────────────────────────────

export type CanonicalIdentitySource =
	| "title_slide"    // page 0 or explicit title layout
	| "domain_email"   // email/URL in document body corroborates a candidate
	| "about_slide"    // "About <Name>", "Company: <Name>", "Introducing <Name>"
	| "repeated_token" // company token appears on 3+ pages
	| "filename"       // inferred from the uploaded document filename
	| "entered_name";  // user-entered deal name (fallback of last resort)

// ─── Confidence tier ──────────────────────────────────────────────────────────

/**
 * - `high`   score ≥ 0.85  (title slide + domain/email corroboration, or very strong cross-slide evidence)
 * - `medium` score ≥ 0.55  (title slide alone, or repeated token + about-slide)
 * - `low`    score ≥ 0.20  (filename inference only, or weak body-text evidence)
 * - `none`   only the user-entered name was available; no document evidence found
 */
export type CanonicalIdentityConfidence = "high" | "medium" | "low" | "none";

// ─── Per-candidate shape ──────────────────────────────────────────────────────

export interface CanonicalIdentityCandidate {
	/** Display form of the extracted name */
	name: string;
	/** Normalised form (lower-case, no suffixes/TLDs) */
	normalized: string;
	/** Aggregate score [0, 1] */
	score: number;
	/** Which extraction signals contributed to this candidate */
	sources: CanonicalIdentitySource[];
	/** Indices of the DPU pages where this name was found (0-based) */
	page_indices: number[];
}

// ─── Resolver output ─────────────────────────────────────────────────────────

export interface CanonicalIdentityResult {
	/** The deal name as entered by the user in the UI — NEVER modified */
	entered_deal_name: string;

	/** The winning canonical company name derived from document evidence */
	canonical_company_name: string;

	/** Confidence level of the canonical name */
	canonical_company_name_confidence: CanonicalIdentityConfidence;

	/** Which signal produced the winner */
	canonical_name_source: CanonicalIdentitySource;

	/**
	 * True when the normalised entered name and the canonical name differ
	 * enough (edit-distance ratio > 0.4) that the user may have typed the
	 * wrong name.  Downstream can surface a UI warning.
	 */
	mismatch_flagged: boolean;

	/** Human-readable evidence summary (for debug / render-package inclusion) */
	identity_evidence: string;

	/** The top-scoring candidate detail */
	winning_candidate: CanonicalIdentityCandidate;

	/** All other candidates that were considered but lost */
	rejected_candidates: CanonicalIdentityCandidate[];
}
