import { describe, expect, test } from 'vitest';
import {
  parseConfidenceLevel,
  getConfidenceDisplayPolicy,
  isHeroPromotable,
  isDetailAllowed,
  isRaiseTermExcluded,
  type ConfidenceLevel,
} from '../lib/confidenceDisplayPolicy';

// ─── parseConfidenceLevel ──────────────────────────────────────────────────────

describe('parseConfidenceLevel', () => {
  const VALID: ConfidenceLevel[] = [
    'VERIFIED',
    'STRONG_EVIDENCE',
    'WEAK_EVIDENCE',
    'CONFLICTING',
    'PROVISIONAL',
    'SUPPRESSED',
  ];

  for (const level of VALID) {
    test(`recognises ${level}`, () => {
      expect(parseConfidenceLevel(level)).toBe(level);
    });
  }

  test('returns null for undefined', () => {
    expect(parseConfidenceLevel(undefined)).toBeNull();
  });

  test('returns null for null', () => {
    expect(parseConfidenceLevel(null)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseConfidenceLevel('')).toBeNull();
  });

  test('returns null for unrecognised value', () => {
    expect(parseConfidenceLevel('UNKNOWN')).toBeNull();
    expect(parseConfidenceLevel('high')).toBeNull();
    expect(parseConfidenceLevel('none')).toBeNull();
  });
});

// ─── getConfidenceDisplayPolicy — surface routing ─────────────────────────────

describe('getConfidenceDisplayPolicy — hero/summary routing', () => {
  test('VERIFIED: allowed everywhere', () => {
    const p = getConfidenceDisplayPolicy('VERIFIED');
    expect(p.level).toBe('VERIFIED');
    expect(p.heroAllowed).toBe(true);
    expect(p.summaryAllowed).toBe(true);
    expect(p.detailAllowed).toBe(true);
    expect(p.dataTabAllowed).toBe(true);
  });

  test('STRONG_EVIDENCE: allowed everywhere', () => {
    const p = getConfidenceDisplayPolicy('STRONG_EVIDENCE');
    expect(p.heroAllowed).toBe(true);
    expect(p.summaryAllowed).toBe(true);
    expect(p.detailAllowed).toBe(true);
    expect(p.dataTabAllowed).toBe(true);
  });

  test('WEAK_EVIDENCE: not hero, not summary; detail + dataTab OK', () => {
    const p = getConfidenceDisplayPolicy('WEAK_EVIDENCE');
    expect(p.heroAllowed).toBe(false);
    expect(p.summaryAllowed).toBe(false);
    expect(p.detailAllowed).toBe(true);
    expect(p.dataTabAllowed).toBe(true);
  });

  test('CONFLICTING: not hero/summary/detail; dataTab only', () => {
    const p = getConfidenceDisplayPolicy('CONFLICTING');
    expect(p.heroAllowed).toBe(false);
    expect(p.summaryAllowed).toBe(false);
    expect(p.detailAllowed).toBe(false);
    expect(p.dataTabAllowed).toBe(true);
  });

  test('PROVISIONAL: not hero/summary/detail; dataTab only', () => {
    const p = getConfidenceDisplayPolicy('PROVISIONAL');
    expect(p.heroAllowed).toBe(false);
    expect(p.summaryAllowed).toBe(false);
    expect(p.detailAllowed).toBe(false);
    expect(p.dataTabAllowed).toBe(true);
  });

  test('SUPPRESSED: blocked from all surfaces', () => {
    const p = getConfidenceDisplayPolicy('SUPPRESSED');
    expect(p.heroAllowed).toBe(false);
    expect(p.summaryAllowed).toBe(false);
    expect(p.detailAllowed).toBe(false);
    expect(p.dataTabAllowed).toBe(false);
  });

  test('legacy (undefined): backward-compat — allowed everywhere, no badge', () => {
    const p = getConfidenceDisplayPolicy(undefined);
    expect(p.level).toBeNull();
    expect(p.heroAllowed).toBe(true);
    expect(p.summaryAllowed).toBe(true);
    expect(p.detailAllowed).toBe(true);
    expect(p.dataTabAllowed).toBe(true);
    expect(p.badgeLabel).toBeNull();
    expect(p.badgeVariant).toBe('unknown');
    expect(p.visualTreatment).toBe('normal');
  });

  test('legacy (null): backward-compat — same as undefined', () => {
    const p = getConfidenceDisplayPolicy(null);
    expect(p.level).toBeNull();
    expect(p.heroAllowed).toBe(true);
    expect(p.badgeLabel).toBeNull();
  });
});

// ─── getConfidenceDisplayPolicy — visual treatment ────────────────────────────

describe('getConfidenceDisplayPolicy — visual treatment', () => {
  test.each([
    ['VERIFIED',        'normal'     ],
    ['STRONG_EVIDENCE', 'normal'     ],
    ['WEAK_EVIDENCE',   'caution'    ],
    ['CONFLICTING',     'conflict'   ],
    ['PROVISIONAL',     'provisional'],
    ['SUPPRESSED',      'suppressed' ],
  ] as const)('%s → visualTreatment=%s', (level, expected) => {
    expect(getConfidenceDisplayPolicy(level).visualTreatment).toBe(expected);
  });
});

// ─── getConfidenceDisplayPolicy — badge labels ────────────────────────────────

describe('getConfidenceDisplayPolicy — badge labels', () => {
  test.each([
    ['VERIFIED',        'Verified',    'verified'   ],
    ['STRONG_EVIDENCE', 'Strong',      'strong'     ],
    ['WEAK_EVIDENCE',   'Weak',        'weak'       ],
    ['CONFLICTING',     'Conflicting', 'conflict'   ],
    ['PROVISIONAL',     'Provisional', 'provisional'],
    ['SUPPRESSED',      'Suppressed',  'suppressed' ],
  ] as const)('%s → badgeLabel=%s, badgeVariant=%s', (level, label, variant) => {
    const p = getConfidenceDisplayPolicy(level);
    expect(p.badgeLabel).toBe(label);
    expect(p.badgeVariant).toBe(variant);
  });
});

// ─── getConfidenceDisplayPolicy — qualifying labels ───────────────────────────

describe('getConfidenceDisplayPolicy — qualifying labels', () => {
  test.each([
    ['VERIFIED',        null                 ],
    ['STRONG_EVIDENCE', null                 ],
    ['WEAK_EVIDENCE',   'limited evidence'   ],
    ['CONFLICTING',     'conflicting signals'],
    ['PROVISIONAL',     'inferred'           ],
    ['SUPPRESSED',      null                 ],
  ] as const)('%s → qualifyingLabel=%s', (level, expected) => {
    expect(getConfidenceDisplayPolicy(level).qualifyingLabel).toBe(expected);
  });
});

// ─── getConfidenceDisplayPolicy — showAsConflict ─────────────────────────────

describe('getConfidenceDisplayPolicy — showAsConflict', () => {
  test('only CONFLICTING returns showAsConflict=true', () => {
    expect(getConfidenceDisplayPolicy('CONFLICTING').showAsConflict).toBe(true);
  });

  test.each(['VERIFIED', 'STRONG_EVIDENCE', 'WEAK_EVIDENCE', 'PROVISIONAL', 'SUPPRESSED'] as const)(
    '%s showAsConflict=false',
    (level) => {
      expect(getConfidenceDisplayPolicy(level).showAsConflict).toBe(false);
    },
  );
});

// ─── isHeroPromotable ─────────────────────────────────────────────────────────

describe('isHeroPromotable', () => {
  test.each(['VERIFIED', 'STRONG_EVIDENCE'] as const)('%s → true', (level) => {
    expect(isHeroPromotable(level)).toBe(true);
  });

  test.each(['WEAK_EVIDENCE', 'CONFLICTING', 'PROVISIONAL', 'SUPPRESSED'] as const)(
    '%s → false',
    (level) => {
      expect(isHeroPromotable(level)).toBe(false);
    },
  );

  test('legacy undefined → true (backward compat)', () => {
    expect(isHeroPromotable(undefined)).toBe(true);
    expect(isHeroPromotable(null)).toBe(true);
  });
});

// ─── isDetailAllowed ──────────────────────────────────────────────────────────

describe('isDetailAllowed', () => {
  test.each(['VERIFIED', 'STRONG_EVIDENCE', 'WEAK_EVIDENCE'] as const)('%s → true', (level) => {
    expect(isDetailAllowed(level)).toBe(true);
  });

  test.each(['CONFLICTING', 'PROVISIONAL', 'SUPPRESSED'] as const)('%s → false', (level) => {
    expect(isDetailAllowed(level)).toBe(false);
  });

  test('legacy undefined → true (backward compat)', () => {
    expect(isDetailAllowed(undefined)).toBe(true);
  });
});

// ─── isRaiseTermExcluded ──────────────────────────────────────────────────────

describe('isRaiseTermExcluded', () => {
  test.each(['CONFLICTING', 'SUPPRESSED'] as const)('%s → true (excluded)', (level) => {
    expect(isRaiseTermExcluded(level)).toBe(true);
  });

  test.each(['VERIFIED', 'STRONG_EVIDENCE', 'WEAK_EVIDENCE', 'PROVISIONAL'] as const)(
    '%s → false (not excluded)',
    (level) => {
      expect(isRaiseTermExcluded(level)).toBe(false);
    },
  );

  test('legacy undefined → false (backward compat)', () => {
    expect(isRaiseTermExcluded(undefined)).toBe(false);
    expect(isRaiseTermExcluded(null)).toBe(false);
  });

  test('unrecognised string → false', () => {
    expect(isRaiseTermExcluded('UNKNOWN')).toBe(false);
    expect(isRaiseTermExcluded('')).toBe(false);
  });
});
