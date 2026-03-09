/**
 * SynthesizedNarrative — multi-paragraph AI summary with optional inline
 * citation popovers.
 *
 * Behaviour:
 *  - Renders up to three paragraphs: executive + business quality + capital/raise.
 *  - Parses `[N]` citation markers in text (for future back-end support).
 *  - When a `[N]` marker is clicked a Popover shows the matching source snippet.
 *  - If `sources` prop is provided, a numbered footnotes row appears below the
 *    narrative (claim corroborations from external diligence).
 *  - Degrades cleanly when no citations exist.
 */

import React, { useState } from 'react';
import type { LlmInterpretationV1 } from '../investorInsightsUtils';
import type { ClaimCorroboration } from '../investorInsightsUtils';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { ExternalLink } from 'lucide-react';

// ── Citation parsing ──────────────────────────────────────────────────────────

type TextSegment = { kind: 'text'; value: string } | { kind: 'citation'; index: number };

/** Split text on `[N]` patterns into alternating text and citation segments. */
function parseSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /\[(\d+)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ kind: 'text', value: text.slice(lastIdx, match.index) });
    }
    segments.push({ kind: 'citation', index: parseInt(match[1], 10) });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIdx) });
  }
  return segments;
}

// ── Citation Popover ──────────────────────────────────────────────────────────

interface CitationRef {
  n: number;
  claimField: string;
  claimValue: string;
  webSignal: string;
  sourceUrl: string;
  verdict: string;
}

interface CitationPopoverProps {
  n: number;
  ref: CitationRef | undefined;
  darkMode: boolean;
}

function CitationPopover({ n, ref: source, darkMode }: CitationPopoverProps) {
  const buttonClass = `inline-flex items-center justify-center w-[1.15rem] h-[1.15rem]
    align-top text-[10px] font-semibold rounded-full border cursor-pointer select-none
    transition-colors ${
      darkMode
        ? 'bg-blue-500/20 border-blue-500/40 text-blue-300 hover:bg-blue-500/35'
        : 'bg-blue-100 border-blue-300 text-blue-700 hover:bg-blue-200'
    }`;

  if (!source) {
    return (
      <span className={buttonClass} aria-label={`Citation ${n}`}>
        {n}
      </span>
    );
  }

  const verdictColor =
    source.verdict === 'corroborated'
      ? darkMode ? 'text-emerald-400' : 'text-emerald-700'
      : source.verdict === 'contradicted'
      ? darkMode ? 'text-red-400' : 'text-red-700'
      : darkMode ? 'text-gray-400' : 'text-gray-500';

  const verdictLabel =
    source.verdict === 'corroborated' ? '✓ Corroborated'
    : source.verdict === 'contradicted' ? '✗ Contradicted'
    : '? Not confirmed';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={buttonClass}
          aria-label={`Show source ${n}`}
        >
          {n}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={`w-80 text-xs ${
          darkMode ? 'bg-gray-900 border-white/15 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
        }`}
        side="top"
        align="start"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-semibold text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              [{n}] {source.claimField}
            </span>
            <span className={`text-xs font-medium ${verdictColor}`}>{verdictLabel}</span>
          </div>
          {source.claimValue && (
            <div className={`text-xs font-mono px-2 py-1 rounded ${darkMode ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
              {source.claimValue}
            </div>
          )}
          <p className={`leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {source.webSignal}
          </p>
          {source.sourceUrl && (
            <a
              href={source.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 text-xs underline underline-offset-2 ${
                darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
              }`}
            >
              <ExternalLink className="w-3 h-3" />
              View source
            </a>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Paragraph with inline citations ──────────────────────────────────────────

interface NarrativeParagraphProps {
  label?: string;
  labelColor: string;
  text: string;
  citations: CitationRef[];
  darkMode: boolean;
}

function NarrativeParagraph({ label, labelColor, text, citations, darkMode }: NarrativeParagraphProps) {
  if (!text || text.trim() === 'Not disclosed.' || text.trim() === 'Not determinable from available signals.') {
    return null;
  }
  const segments = parseSegments(text);

  return (
    <div className="space-y-1">
      {label && (
        <div className={`text-[10px] font-semibold uppercase tracking-widest ${labelColor}`}>
          {label}
        </div>
      )}
      <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
        {segments.map((seg, i) => {
          if (seg.kind === 'text') return <span key={i}>{seg.value}</span>;
          const ref = citations.find((c) => c.n === seg.index);
          return <CitationPopover key={i} n={seg.index} ref={ref} darkMode={darkMode} />;
        })}
      </p>
    </div>
  );
}

// ── Source footnotes ──────────────────────────────────────────────────────────

interface SourceFootnotesProps {
  citations: CitationRef[];
  darkMode: boolean;
}

function SourceFootnotes({ citations, darkMode }: SourceFootnotesProps) {
  if (citations.length === 0) return null;

  return (
    <div className={`mt-3 pt-3 border-t space-y-1.5 ${darkMode ? 'border-white/10' : 'border-gray-200'}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        Sources
      </div>
      {citations.map((c) => {
        const verdictColor =
          c.verdict === 'corroborated' ? (darkMode ? 'text-emerald-400' : 'text-emerald-700')
          : c.verdict === 'contradicted' ? (darkMode ? 'text-red-400' : 'text-red-700')
          : (darkMode ? 'text-gray-500' : 'text-gray-400');

        return (
          <div key={c.n} className="flex items-start gap-2 text-xs">
            <span className={`shrink-0 font-mono font-semibold w-4 text-right ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              [{c.n}]
            </span>
            <div className="flex-1 min-w-0">
              <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {c.claimField}
              </span>
              {c.claimValue && (
                <span className={`ml-1 font-mono ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  = {c.claimValue}
                </span>
              )}
              <span className={`ml-1.5 font-medium ${verdictColor}`}>
                {c.verdict === 'corroborated' ? '✓'
                  : c.verdict === 'contradicted' ? '✗'
                  : '?'}
              </span>
            </div>
            {c.sourceUrl && (
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`shrink-0 ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
                aria-label="Open source"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Synthesized Narrative ─────────────────────────────────────────────────────

export interface SynthesizedNarrativeProps {
  data: LlmInterpretationV1;
  /** Claim corroborations from external diligence — used to number and hyperlink sources. */
  corroborations?: ClaimCorroboration[];
  darkMode: boolean;
}

export function SynthesizedNarrative({ data, corroborations = [], darkMode }: SynthesizedNarrativeProps) {
  // Build citation refs from corroborations (1-indexed)
  const citations: CitationRef[] = corroborations.map((c, i) => ({
    n: i + 1,
    claimField: c.claim_field,
    claimValue: c.claim_value,
    webSignal: c.web_signal,
    sourceUrl: c.source_url,
    verdict: c.verdict,
  }));

  const borderClass = `rounded-xl border p-4 ${
    darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-white'
  }`;

  return (
    <div className={borderClass}>
      <div className={`text-[10px] font-semibold uppercase tracking-widest mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        Investment Narrative
      </div>
      <div className="space-y-4">
        {/* Para 1: Executive summary */}
        <NarrativeParagraph
          text={data.executive_summary}
          labelColor={darkMode ? 'text-gray-500' : 'text-gray-400'}
          citations={citations}
          darkMode={darkMode}
        />

        {/* Para 2: Business quality */}
        <NarrativeParagraph
          label="Business Quality"
          labelColor={darkMode ? 'text-violet-400/70' : 'text-violet-600/70'}
          text={data.business_quality || ''}
          citations={citations}
          darkMode={darkMode}
        />

        {/* Para 3: Capital & Raise interpretation */}
        <NarrativeParagraph
          label="Capital & Raise"
          labelColor={darkMode ? 'text-indigo-400/70' : 'text-indigo-600/70'}
          text={data.capital_and_raise_interpretation || ''}
          citations={citations}
          darkMode={darkMode}
        />
      </div>

      {/* PR35: source footnotes from external diligence claim corroborations */}
      <SourceFootnotes citations={citations} darkMode={darkMode} />
    </div>
  );
}
