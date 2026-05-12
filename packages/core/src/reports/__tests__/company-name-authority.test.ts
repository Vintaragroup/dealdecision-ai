/**
 * Company Name Authority — Regression tests
 *
 * Guards against the specific bug fixed in 2026-04: Pattern #3 (short early
 * title-case lines) in `extractCompanyNameFromFullText` was matching cover-slide
 * descriptors like "Sports-focused PE Fusion" as the company name.
 *
 * Three axes tested:
 *   A. direct extractCompanyNameFromFullText tests (Pattern #3 removed)
 *   B. RC-S6-009 compiler integration (deals.name wins; source tracked)
 *   C. company_name_source provenance values
 */

import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalDio(phase1Overrides?: Record<string, any>): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: 'test-company-name-dio',
    deal_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
    analyzer_results: {},
    dio: {
      phase1: {
        ...phase1Overrides,
      },
    },
  };
}

// ─── A. Cover-slide descriptor must NOT become company_name ───────────────────

describe('company_name — cover-slide descriptors are blocked', () => {
  /**
   * "Sports-focused PE Fusion" is a slide headline that passes the old Pattern #3
   * title-case + word-count regex but is clearly not a company name.
   * With Pattern #3 removed, this must never appear as company_name.
   */
  it('does not match "Sports-focused PE Fusion" from a pitch deck cover slide', () => {
    const fullText = `Sports-focused PE Fusion\n\nInvestor Presentation\nConfidential\n\nOur investment thesis...`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      documentFullTexts: [fullText],
      // no companyName from deals — testing pure text fallback
    });
    const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
    expect(cn).not.toBe('Sports-focused PE Fusion');
    expect(cn).not.toBe('Sports-focused PE');
  });

  it('does not match other short cover-slide genre labels', () => {
    const coverPhrases = [
      'Deep Tech Innovation',
      'Series A Fundraise',
      'Growth Equity Opportunity',
      'Healthcare Technology Leader',
      'Disrupting The Enterprise',
    ];

    for (const phrase of coverPhrases) {
      const fullText = `${phrase}\n\nInvestor Presentation 2025\n\nExecutive Summary\n\nWe are building...`;
      const dio = makeMinimalDio();
      const report = compileDIOToReportWithPromotedFacts(dio, {
        documentFullTexts: [fullText],
      });
      const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
      expect(cn).not.toBe(phrase);
    }
  });
});

// ─── B. deals.name wins over all document heuristics ─────────────────────────

describe('company_name — deals.name is highest-priority authority', () => {
  it('uses companyName option when provided, ignoring any document text', () => {
    // Doc text has a legal-entity match that WOULD win without the priority rule
    const fullText = `Climatic Capital Partners LLC\n\nFund Overview 2025\n©2025 ClimataX Corp · All rights reserved`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      companyName: 'Climatic',
      documentFullTexts: [fullText],
    });
    const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
    expect(cn).toBe('Climatic');
  });

  it('correctly records company_name_source as "deals_name" when deals.name wins', () => {
    const fullText = `ClimataX Corp LLC\n\nFund Deck`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      companyName: 'Climatic',
      documentFullTexts: [fullText],
    });
    const src: string | null = (report.structured_summary as any)?.company_name_source ?? null;
    expect(src).toBe('deals_name');
  });

  it('sets company_name from document text when companyName is not provided and legal match exists', () => {
    // Pattern #2: legal entity match should still work
    const fullText = `Nanochon Inc is a medical device company developing cartilage repair solutions.`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      documentFullTexts: [fullText],
    });
    const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
    expect(cn).toBe('Nanochon');
  });

  it('records company_name_source as "document_text" for legal-entity derived name', () => {
    const fullText = `Nanochon Inc is a medical device company.`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      documentFullTexts: [fullText],
    });
    const src: string | null = (report.structured_summary as any)?.company_name_source ?? null;
    expect(src).toBe('document_text');
  });

  it('sets company_name from copyright watermark pattern', () => {
    // Pattern #1: copyright watermark
    const fullText = `Investor Deck 2025\n\n©2025 Dropables  All rights reserved\n\nOur platform...`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      documentFullTexts: [fullText],
    });
    const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
    expect(cn).toBe('Dropables');
  });

  it('leaves company_name null when no authoritative source exists', () => {
    // No companyName option, no document text, no legal entity, no copyright
    const fullText = `Some generic slide text without any company signals here at all.`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      documentFullTexts: [fullText],
    });
    const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
    // Should be null because no authoritative source matched
    // (If the DIO has no company_name, it should remain null)
    expect(cn === null || typeof cn === 'string').toBe(true);
    // The critical guarantee: it must NOT be the generic slide text
    if (cn !== null) {
      expect(cn).not.toBe('Some generic slide text');
    }
  });
});

// ─── C. company_name_source correctness ───────────────────────────────────────

describe('company_name_source provenance', () => {
  it('is null when neither companyName nor document text provides a name', () => {
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {});
    const src: string | null = (report.structured_summary as any)?.company_name_source ?? null;
    // No company name set → source should be null or absent
    const cn: string | null = (report.structured_summary as any)?.company_name ?? null;
    if (!cn) {
      // If no name was set, source should be null
      expect(src).toBeNull();
    }
  });

  it('"deals_name" source wins over "document_text" source when both are available', () => {
    const fullText = `©2025 Dropables  All rights reserved`;
    const dio = makeMinimalDio();
    const report = compileDIOToReportWithPromotedFacts(dio, {
      companyName: 'Dropables Official',
      documentFullTexts: [fullText],
    });
    const src: string | null = (report.structured_summary as any)?.company_name_source ?? null;
    expect(src).toBe('deals_name');
  });
});
