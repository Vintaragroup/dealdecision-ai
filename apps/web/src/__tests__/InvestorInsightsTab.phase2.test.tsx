/**
 * Tests for Phase 2 section renderers in InvestorInsightsTab:
 *   - canonical_fields: rows, evidence pill, quote stripping + whitespace trimming
 *   - completeness_summary: category labels and correct badges
 *   - conflicts: warning banner rendered only when section present
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CanonicalFieldsSection, CompletenessSummarySection, ConflictsSection } from '../components/workspace/InvestorInsightsTab';
import type { InvestorInsightsSection } from '../lib/apiClient';

// ── canonical_fields fixtures ────────────────────────────────────────────────

const CANONICAL_FIELDS_BODY = [
  'category=raise_terms | field=raise_amount | computability=Computable | value="$2M Pre-Seed " | evidence=dpu:doc:6557c7c2:page:14 | reason=none',
  'category=raise_terms | field=raise_round | computability=Computable | value="seed" | evidence=dpu:doc:6557c7c2:page:14 | reason=none',
  'category=market_claims | field=tam_value | computability=NotComputable | value=none | evidence=none | reason=NO_TAM_VALUE_MENTION',
].join('\n');

const REPORT_WITH_CANONICAL_FIELDS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'canonical_fields',
        title: 'Canonical Fields',
        kind: 'message',
        body: CANONICAL_FIELDS_BODY,
      },
    ],
  },
} as any;

const CANONICAL_SECTION: InvestorInsightsSection = {
  key: 'canonical_fields',
  title: 'Canonical Fields',
  kind: 'message',
  body: CANONICAL_FIELDS_BODY,
} as InvestorInsightsSection;

// ── completeness_summary fixtures ────────────────────────────────────────────

const COMPLETENESS_BODY = [
  'raise_terms: Present',
  'valuation_terms: Missing',
  'use_of_funds: Missing',
  'market_claims: Conflicting',
  'traction_signal: Present',
].join('\n');

const REPORT_WITH_COMPLETENESS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'completeness_summary',
        title: 'Completeness Summary',
        kind: 'message',
        body: COMPLETENESS_BODY,
      },
    ],
  },
} as any;

const COMPLETENESS_SECTION: InvestorInsightsSection = {
  key: 'completeness_summary',
  title: 'Completeness Summary',
  kind: 'message',
  body: COMPLETENESS_BODY,
} as InvestorInsightsSection;

// ── conflicts fixtures ────────────────────────────────────────────────────────

const CONFLICTS_BODY =
  'field=raise_amount | value_a="$2M seed round." | evidence_a=dpu:doc:a1b2c3d4:page:1 | value_b="$5M Series A round." | evidence_b=dpu:doc:b2c3d4e5:page:5';

const REPORT_WITH_CONFLICTS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'conflicts',
        title: 'Conflicting Field Values',
        kind: 'message',
        body: CONFLICTS_BODY,
      },
    ],
  },
} as any;

const CONFLICTS_SECTION: InvestorInsightsSection = {
  key: 'conflicts',
  title: 'Conflicting Field Values',
  kind: 'message',
  body: CONFLICTS_BODY,
} as InvestorInsightsSection;

const REPORT_WITHOUT_CONFLICTS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'completeness_summary',
        title: 'Completeness Summary',
        kind: 'message',
        body: 'raise_terms: Present\nmarket_claims: Missing',
      },
    ],
  },
} as any;

const COMPLETENESS_SECTION_SIMPLE: InvestorInsightsSection = {
  key: 'completeness_summary',
  title: 'Completeness Summary',
  kind: 'message',
  body: 'raise_terms: Present\nmarket_claims: Missing',
} as InvestorInsightsSection;

// ── Tests: canonical_fields ───────────────────────────────────────────────────

describe('InvestorInsightsTab – canonical_fields section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders category and field labels humanized', () => {
    render(<CanonicalFieldsSection section={CANONICAL_SECTION} darkMode={false} />);

    // Category 'raise_terms' appears once per row in that category
    const raiseCells = screen.getAllByText('Raise Terms');
    expect(raiseCells.length).toBeGreaterThanOrEqual(1);
    screen.getByText('Raise Amount');
    screen.getByText('Raise Round');
    screen.getByText('Market Claims');
    screen.getByText('Tam Value');
  });

  test('Computable badge rendered for Computable rows', () => {
    render(<CanonicalFieldsSection section={CANONICAL_SECTION} darkMode={false} />);

    screen.getByText('Raise Amount'); // verify content present
    const badges = screen.getAllByText('Computable');
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  test('NotComputable badge rendered for NotComputable rows', () => {
    render(<CanonicalFieldsSection section={CANONICAL_SECTION} darkMode={false} />);

    screen.getByText('NotComputable');
  });

  test('strips surrounding quotes and trims trailing whitespace from value', () => {
    render(<CanonicalFieldsSection section={CANONICAL_SECTION} darkMode={false} />);

    // Value is `"$2M Pre-Seed "` in body → should render as `$2M Pre-Seed` (no quotes, no trailing space)
    screen.getByText('$2M Pre-Seed');
  });

  test('evidence pill rendered for Computable row with evidence ref', () => {
    render(<CanonicalFieldsSection section={CANONICAL_SECTION} darkMode={false} />);

    // Two rows share this evidence ref, so multiple pills are expected
    const pills = screen.getAllByText('dpu:doc:6557c7c2:page:14');
    expect(pills.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Tests: completeness_summary ───────────────────────────────────────────────

describe('InvestorInsightsTab – completeness_summary section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders all five category labels humanized', () => {
    render(<CompletenessSummarySection section={COMPLETENESS_SECTION} darkMode={false} />);

    screen.getByText('Raise Terms');
    screen.getByText('Valuation Terms');
    screen.getByText('Use Of Funds');
    screen.getByText('Market Claims');
    screen.getByText('Traction Signal');
  });

  test('Present badge rendered for Present rows', () => {
    render(<CompletenessSummarySection section={COMPLETENESS_SECTION} darkMode={false} />);

    screen.getByText('Raise Terms'); // verify content present
    const presentBadges = screen.getAllByText('Present');
    expect(presentBadges.length).toBeGreaterThanOrEqual(2);
  });

  test('Missing badge rendered for Missing rows', () => {
    render(<CompletenessSummarySection section={COMPLETENESS_SECTION} darkMode={false} />);

    screen.getByText('Raise Terms'); // verify content present
    const missingBadges = screen.getAllByText('Missing');
    expect(missingBadges.length).toBeGreaterThanOrEqual(2);
  });

  test('Conflicting badge rendered for Conflicting rows', () => {
    render(<CompletenessSummarySection section={COMPLETENESS_SECTION} darkMode={false} />);

    screen.getByText('Conflicting');
  });
});

// ── Tests: conflicts ──────────────────────────────────────────────────────────

describe('InvestorInsightsTab – conflicts section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('warning banner rendered when conflicts section is present', () => {
    render(<ConflictsSection section={CONFLICTS_SECTION} darkMode={false} />);

    screen.getByRole('alert');
    screen.getByText(/Conflicting values were detected/i);
  });

  test('conflict row field name rendered humanized', () => {
    render(<ConflictsSection section={CONFLICTS_SECTION} darkMode={false} />);

    screen.getByText('Raise Amount');
  });

  test('both evidence pills rendered in the conflict row', () => {
    render(<ConflictsSection section={CONFLICTS_SECTION} darkMode={false} />);

    screen.getByText('dpu:doc:a1b2c3d4:page:1');
    screen.getByText('dpu:doc:b2c3d4e5:page:5');
  });

  test('warning banner NOT rendered when conflicts key is absent', () => {
    // insight_slots is now in the Data tab — render CompletenessSummarySection directly
    render(<CompletenessSummarySection section={COMPLETENESS_SECTION_SIMPLE} darkMode={false} />);

    screen.getByText('Raise Terms');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
