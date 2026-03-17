/**
 * CanonicalIdentityRenameBanner
 *
 * Shown after analysis when the canonical company identity resolver detects
 * that the deal's entered name doesn't match the company name found in the
 * uploaded deck (confidence high/medium only).
 *
 * Rename uses the existing PUT /api/v1/deals/:deal_id endpoint.
 * Dismiss is persisted in localStorage keyed by deal + canonical name so it
 * survives refresh and reappears automatically when a new analysis produces
 * a different canonical name.
 */

import React, { useEffect, useState } from 'react';
import { apiUpdateDeal } from '../../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CanonicalIdentity {
  entered_name: string;
  canonical_company_name: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  mismatch_flagged: boolean;
  evidence_summary: string | null;
}

interface Props {
  dealId: string;
  currentDealName: string;
  canonicalIdentity: CanonicalIdentity | undefined | null;
  darkMode?: boolean;
  onRenameSuccess: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeForComparison(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function dismissKey(dealId: string, canonicalName: string): string {
  return `ddai:canonical_dismiss:${dealId}:${normalizeForComparison(canonicalName)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CanonicalIdentityRenameBanner({ dealId, currentDealName, canonicalIdentity, darkMode, onRenameSuccess }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Check localStorage on mount (or when canonicalIdentity changes)
  useEffect(() => {
    if (!canonicalIdentity?.canonical_company_name) return;
    const key = dismissKey(dealId, canonicalIdentity.canonical_company_name);
    if (localStorage.getItem(key) === '1') {
      setDismissed(true);
    } else {
      setDismissed(false);
    }
  }, [dealId, canonicalIdentity?.canonical_company_name]);

  // Determine whether to show
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[CanonicalIdentityBanner] evaluate', {
      canonicalIdentity,
      currentDealName,
      dismissed,
    });
  }
  if (!canonicalIdentity) return null;
  const { canonical_company_name, confidence, mismatch_flagged } = canonicalIdentity;
  if (!mismatch_flagged) return null;
  if (confidence !== 'high' && confidence !== 'medium') return null;
  if (normalizeForComparison(canonical_company_name) === normalizeForComparison(currentDealName)) return null;
  if (dismissed) return null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleRename = async () => {
    setIsRenaming(true);
    setRenameError(null);
    try {
      await apiUpdateDeal(dealId, { name: canonical_company_name });
      onRenameSuccess();
      // Persist dismissal so the banner doesn't reappear after the name matches
      const key = dismissKey(dealId, canonical_company_name);
      localStorage.setItem(key, '1');
      setDismissed(true);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDismiss = () => {
    const key = dismissKey(dealId, canonical_company_name);
    localStorage.setItem(key, '1');
    setDismissed(true);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const bgClasses = darkMode
    ? 'bg-amber-900/20 border-amber-500/30 text-amber-100'
    : 'bg-amber-50 border-amber-300 text-amber-900';

  const mutedClasses = darkMode ? 'text-amber-300/70' : 'text-amber-700';

  const renameBtnClasses = darkMode
    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40'
    : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300';

  const dismissBtnClasses = darkMode
    ? 'text-amber-400/70 hover:text-amber-300'
    : 'text-amber-600 hover:text-amber-800';

  const confidenceBadgeClasses = confidence === 'high'
    ? (darkMode ? 'bg-green-900/30 text-green-300' : 'bg-green-100 text-green-700')
    : (darkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-100 text-amber-700');

  return (
    <div className={`mt-3 rounded-xl border px-4 py-3 text-sm ${bgClasses}`} role="alert">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-snug">
            Deck identifies this company as{' '}
            <span className="font-semibold">"{canonical_company_name}"</span>
          </p>
          <p className={`mt-0.5 text-xs leading-snug ${mutedClasses}`}>
            Your deal is currently named{' '}
            <span className="font-medium">"{currentDealName}"</span>.{' '}
            Rename it to match the company name found in the uploaded documents?{' '}
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${confidenceBadgeClasses}`}>
              {confidence} confidence
            </span>
          </p>
          {renameError && (
            <p className="mt-1 text-xs text-red-400">{renameError}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleRename}
            disabled={isRenaming}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${renameBtnClasses}`}
          >
            {isRenaming ? 'Renaming…' : `Rename to "${canonical_company_name}"`}
          </button>
          <button
            onClick={handleDismiss}
            className={`text-xs transition-colors ${dismissBtnClasses}`}
            aria-label="Dismiss rename suggestion"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
