/**
 * scope-guard-ai-analysis.test.ts
 *
 * PHASE 1 — Static safety / scope proof for the AI Analysis Tab Deal Terms
 * feature.
 *
 * Guarantees that the DealTermsCard feature does not bleed into the restricted
 * Investor Insights rendering surface.  Runs two types of checks:
 *
 *  A) Static import graph — verify DealTermsCard is NOT imported from any of
 *     the prohibited files by reading their source text.
 *
 *  B) Git diff guard — when running inside a git working tree, verify that the
 *     current HEAD diff does NOT modify any prohibited paths.
 *     Skipped automatically when git is unavailable (CI environments without
 *     a checkout, or outside a repo).
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

// ─── Paths ────────────────────────────────────────────────────────────────────

const WEB_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(WEB_ROOT, '../..');

// Prohibited files that MUST NOT be modified by the AI Analysis Tab feature.
const PROHIBITED_PATHS = [
  'apps/web/src/components/workspace/InvestorInsightsTab.tsx',
  'apps/web/src/components/pages/DueDiligenceReport.tsx',
  'apps/web/src/components/reports',                    // entire directory guard
  'apps/worker/src/jobs/investor-insights',             // entire directory guard
];

// Only the new AI Analysis files should be touched.
const PERMITTED_NEW_FILES = [
  'apps/web/src/components/workspace/DealTermsCard.tsx',
  'apps/web/src/hooks/useDealTermsAnalysis.ts',
  'apps/web/src/__tests__/DealTermsCard.test.tsx',
  'apps/web/src/__tests__/scope-guard-ai-analysis.test.ts',
  // Market Analysis feature
  'apps/web/src/components/workspace/MarketAnalysisCard.tsx',
  'apps/web/src/hooks/useMarketAnalysis.ts',
  'apps/web/src/__tests__/MarketAnalysisCard.test.tsx',
  // Financial Analysis feature
  'apps/web/src/components/workspace/analysis/FinancialAnalysisSection.tsx',
  'apps/web/src/hooks/useFinancialAnalysis.ts',
  'apps/web/src/__tests__/FinancialAnalysisSection.test.tsx',
  // Risk & Verification feature
  'apps/web/src/components/workspace/analysis/RiskVerificationSection.tsx',
  'apps/web/src/hooks/useRiskVerification.ts',
  'apps/web/src/__tests__/RiskVerificationSection.test.tsx',
  'apps/api/src/__tests__/risk-verification-analysis.test.ts',
  // Orchestrator Deal Intelligence Score feature
  'apps/web/src/components/workspace/analysis/OrchestratorSummaryCard.tsx',
  'apps/web/src/hooks/useOrchestratorReport.ts',
  'apps/web/src/__tests__/OrchestratorSummaryCard.test.tsx',
  'apps/web/src/__tests__/OrchestratorSummaryCard.integration.test.tsx',
  'apps/api/src/__tests__/orchestrator-report.test.ts',
  'packages/core/src/orchestrator',
  // Decision Overlay feature
  'apps/web/src/components/workspace/analysis/DecisionOverlay.tsx',
  'apps/web/src/__tests__/DecisionOverlay.test.tsx',
  'apps/web/src/__tests__/DecisionOverlay.integration.test.tsx',
  // OrchestratorFullReportView composition component
  'apps/web/src/components/workspace/OrchestratorFullReportView.tsx',
  'apps/web/src/__tests__/OrchestratorFullReportView.test.tsx',
  // Gate 1 DPU backfill — auto-enqueue DPU when missing/stale/partial
  'apps/api/src/__tests__/gate1-dpu-backfill.test.ts',
  'apps/web/src/__tests__/OrchestratorFullReportView.dpuBackfill.test.tsx',
  // Document Readiness panel — AI Analysis tab read-only diagnostic card
  'apps/web/src/components/workspace/analysis/DocumentReadinessCard.tsx',
  'apps/web/src/__tests__/DocumentReadinessCard.test.tsx',
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function readWebFile(relativePath: string): string {
  const abs = resolve(WEB_ROOT, 'src', relativePath);
  return existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
}

// ─── A) Static import graph checks ───────────────────────────────────────────

describe('Scope guard — DealTermsCard import isolation', () => {
  test('InvestorInsightsTab.tsx does NOT import DealTermsCard', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('DealTermsCard');
    expect(src).not.toContain('useDealTermsAnalysis');
  });

  test('InvestorReportView.tsx imports DealTermsCard (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain("import { DealTermsCard } from './DealTermsCard'");
  });

  test('InvestorInsightsTab.tsx does NOT import MarketAnalysisCard', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('MarketAnalysisCard');
    expect(src).not.toContain('useMarketAnalysis');
  });

  test('InvestorReportView.tsx imports MarketAnalysisCard (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain("import { MarketAnalysisCard } from './MarketAnalysisCard'");
  });

  test('InvestorInsightsTab.tsx does NOT import FinancialAnalysisSection', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('FinancialAnalysisSection');
    expect(src).not.toContain('useFinancialAnalysis');
  });

  test('InvestorReportView.tsx imports FinancialAnalysisSection (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain("FinancialAnalysisSection");
  });
  test('InvestorInsightsTab.tsx does NOT import RiskVerificationSection', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('RiskVerificationSection');
    expect(src).not.toContain('useRiskVerification');
  });

  test('InvestorReportView.tsx imports RiskVerificationSection (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain('RiskVerificationSection');
  });

  test('InvestorInsightsTab.tsx does NOT import OrchestratorSummaryCard', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('OrchestratorSummaryCard');
    expect(src).not.toContain('useOrchestratorReport');
  });

  test('InvestorReportView.tsx imports OrchestratorSummaryCard (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain('OrchestratorSummaryCard');
  });

  test('InvestorInsightsTab.tsx does NOT import DecisionOverlay', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('DecisionOverlay');
  });

  test('InvestorReportView.tsx imports DecisionOverlay (approved embedded consumer)', () => {
    const src = readWebFile('components/workspace/InvestorReportView.tsx');
    expect(src).toContain('DecisionOverlay');
  });

  test('InvestorInsightsTab.tsx does NOT import OrchestratorFullReportView', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('OrchestratorFullReportView');
  });

  test('InvestorInsightsTab.tsx does NOT import DocumentReadinessCard', () => {
    const src = readWebFile('components/workspace/InvestorInsightsTab.tsx');
    expect(src).not.toContain('DocumentReadinessCard');
  });

  test('OrchestratorFullReportView.tsx imports DocumentReadinessCard (approved composition consumer)', () => {
    const src = readWebFile('components/workspace/OrchestratorFullReportView.tsx');
    expect(src).toContain('DocumentReadinessCard');
  });

  test('AnalysisTab.tsx imports OrchestratorFullReportView (approved composition consumer)', () => {
    const src = readWebFile('components/workspace/AnalysisTab.tsx');
    expect(src).toContain('OrchestratorFullReportView');
  });

  test('DueDiligenceReport files do NOT import MarketAnalysisCard', () => {
    const pagesDir = resolve(WEB_ROOT, 'src/components/pages');
    if (!existsSync(pagesDir)) return;
    const { readdirSync } = require('fs') as typeof import('fs');
    const ddFiles = readdirSync(pagesDir).filter((f: string) => f.startsWith('DueDiligenceReport'));
    for (const file of ddFiles) {
      const src = readFileSync(resolve(pagesDir, file), 'utf-8');
      expect(src, `${file} must not import MarketAnalysisCard`).not.toContain('MarketAnalysisCard');
      expect(src, `${file} must not import useMarketAnalysis`).not.toContain('useMarketAnalysis');
    }
  });

  test('DueDiligenceReport files do NOT import DealTermsCard', () => {
    // Iterate any DueDiligence* file under pages/
    const pagesDir = resolve(WEB_ROOT, 'src/components/pages');
    if (!existsSync(pagesDir)) return;
    const { readdirSync } = require('fs') as typeof import('fs');
    const ddFiles = readdirSync(pagesDir).filter((f: string) => f.startsWith('DueDiligenceReport'));
    for (const file of ddFiles) {
      const src = readFileSync(resolve(pagesDir, file), 'utf-8');
      expect(src, `${file} must not import DealTermsCard`).not.toContain('DealTermsCard');
      expect(src, `${file} must not import useDealTermsAnalysis`).not.toContain('useDealTermsAnalysis');
    }
  });

  test('No file under apps/web/src/components/reports imports DealTermsCard', () => {
    const reportsDir = resolve(WEB_ROOT, 'src/components/reports');
    if (!existsSync(reportsDir)) return;
    const { readdirSync } = require('fs') as typeof import('fs');
    function scanDir(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
          const src = readFileSync(full, 'utf-8');
          expect(src, `${entry.name} must not import DealTermsCard`).not.toContain('DealTermsCard');
          expect(src, `${entry.name} must not import useDealTermsAnalysis`).not.toContain('useDealTermsAnalysis');
        }
      }
    }
    scanDir(reportsDir);
  });

  test('DealTermsCard.tsx, MarketAnalysisCard.tsx, FinancialAnalysisSection.tsx, OrchestratorSummaryCard.tsx, and DecisionOverlay.tsx are exclusively imported by AnalysisTab.tsx and InvestorReportView.tsx', () => {
    // Scan the entire workspace/* components directory (except approved consumers and tests)
    // and verify no unexpected file imports DealTermsCard, MarketAnalysisCard, FinancialAnalysisSection,
    // RiskVerificationSection, or OrchestratorSummaryCard.
    const componentsDir = resolve(WEB_ROOT, 'src/components');
    const hooksDir = resolve(WEB_ROOT, 'src/hooks');
    if (!existsSync(componentsDir)) return;

    const { readdirSync } = require('fs') as typeof import('fs');
    const violations: string[] = [];

    function scanDir(dir: string) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        // Skip approved consumers and the components themselves
        if (
          entry.name === 'AnalysisTab.tsx' ||
          entry.name === 'InvestorReportView.tsx' ||
          entry.name === 'DealTermsCard.tsx' ||
          entry.name === 'MarketAnalysisCard.tsx' ||
          entry.name === 'FinancialAnalysisSection.tsx' ||
          entry.name === 'RiskVerificationSection.tsx' ||
          entry.name === 'OrchestratorSummaryCard.tsx' ||
          entry.name === 'DecisionOverlay.tsx' ||
          entry.name === 'DocumentReadinessCard.tsx' ||
          entry.name === 'OrchestratorFullReportView.tsx' ||
          entry.name === 'useFinancialAnalysis.ts' ||
          entry.name === 'useRiskVerification.ts' ||
          entry.name === 'useMarketAnalysis.ts' ||
          entry.name === 'useDealTermsAnalysis.ts' ||
          entry.name === 'useOrchestratorReport.ts' ||
          full.includes('__tests__')
        ) continue;
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
          const src = readFileSync(full, 'utf-8');
          if (
            src.includes('DealTermsCard') ||
            src.includes('MarketAnalysisCard') ||
            src.includes('FinancialAnalysisSection') ||
            src.includes('RiskVerificationSection') ||
            src.includes('OrchestratorSummaryCard') ||
            src.includes('DecisionOverlay')
          ) {
            violations.push(entry.name);
          }
        }
      }
    }
    scanDir(componentsDir);
    if (existsSync(hooksDir)) scanDir(hooksDir);

    expect(violations, `Unexpected files import DealTermsCard, MarketAnalysisCard, FinancialAnalysisSection, RiskVerificationSection, OrchestratorSummaryCard, or DecisionOverlay: ${violations.join(', ')}`).toHaveLength(0);
  });

  test('apiPostDealTermsAnalysis is only called from useDealTermsAnalysis hook and tests', () => {
    const hooksDir = resolve(WEB_ROOT, 'src/hooks');
    const libDir = resolve(WEB_ROOT, 'src/lib');
    const componentsDir = resolve(WEB_ROOT, 'src/components');
    const { readdirSync } = require('fs') as typeof import('fs');
    const violations: string[] = [];

    function scanFile(full: string, name: string) {
      if (name === 'useDealTermsAnalysis.ts') return; // allowed consumer
      if (name === 'apiClient.ts') return;            // definition
      if (full.includes('__tests__')) return;         // tests allowed
      const src = readFileSync(full, 'utf-8');
      if (src.includes('apiPostDealTermsAnalysis')) {
        violations.push(name);
      }
    }

    function scanDir(dir: string) {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) scanDir(full);
        else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) scanFile(full, entry.name);
      }
    }

    scanDir(hooksDir);
    scanDir(libDir);
    scanDir(componentsDir);

    expect(violations, `Unexpected files call apiPostDealTermsAnalysis: ${violations.join(', ')}`).toHaveLength(0);
  });
});

// ─── B) Git diff guard ────────────────────────────────────────────────────────
//
// This guard checks COMMIT-level isolation: does the commit (or the PR branch)
// that introduced DealTermsCard ALSO touch prohibited investor-insights files?
//
// Strategy:
//   1. Walk the last N commits looking for any commit that touched a feature file
//   2. Check whether THAT commit also touched a prohibited file
//   3. Skip gracefully when git / git history is unavailable
//
// We do NOT check the full working-tree diff (git diff HEAD) because an active
// repo will always have unrelated in-progress changes that would create false
// positives.

describe('Scope guard — git diff protection', () => {
  function getFilesInCommit(sha: string): string[] {
    try {
      const raw = execSync(`git show --name-only --format="" ${sha}`, {
        cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return raw.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  function getRecentCommitShas(n = 20): string[] {
    try {
      const raw = execSync(`git log --format="%H" -n ${n}`, {
        cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return raw.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  test('no commit that introduced DealTermsCard also modified prohibited files', () => {
    const FEATURE_MARKERS = ['DealTermsCard', 'useDealTermsAnalysis', 'deal-terms-analysis', 'MarketAnalysisCard', 'useMarketAnalysis', 'market-analysis', 'FinancialAnalysisSection', 'useFinancialAnalysis', 'financial-analysis', 'RiskVerificationSection', 'useRiskVerification', 'risk-verification'];

    let shas: string[];
    try {
      shas = getRecentCommitShas(30);
    } catch {
      console.info('[scope-guard] git not available, skipping commit diff check');
      return;
    }

    if (shas.length === 0) {
      console.info('[scope-guard] no git history found, skipping');
      return;
    }

    for (const sha of shas) {
      const files = getFilesInCommit(sha);
      const touchesFeature = files.some((f) => FEATURE_MARKERS.some((m) => f.includes(m)));
      if (!touchesFeature) continue;

      // This commit includes DealTermsCard-related files — check it doesn't also
      // touch prohibited paths.
      const prohibited = files.filter((f) =>
        PROHIBITED_PATHS.some((p) => f === p || f.startsWith(p + '/')),
      );

      expect(
        prohibited,
        `Commit ${sha.slice(0, 8)} that introduced DealTermsCard also modified prohibited files:\n` +
          prohibited.join('\n'),
      ).toHaveLength(0);
    }
  });

  test('staged changes do not mix DealTermsCard with prohibited files', () => {
    // Check the staging area: if the developer is about to commit, the staged
    // files must not combine feature files AND prohibited files in the same batch.
    let stagedFiles: string[];
    try {
      const raw = execSync('git diff --name-only --cached', {
        cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      stagedFiles = raw.trim().split('\n').filter(Boolean);
    } catch {
      console.info('[scope-guard] git not available, skipping staged-files check');
      return;
    }

    if (stagedFiles.length === 0) return; // nothing staged — skip

    const FEATURE_MARKERS = ['DealTermsCard', 'useDealTermsAnalysis', 'deal-terms', 'MarketAnalysisCard', 'useMarketAnalysis', 'market-analysis', 'FinancialAnalysisSection', 'useFinancialAnalysis', 'financial-analysis', 'RiskVerificationSection', 'useRiskVerification', 'risk-verification'];
    const touchesFeature = stagedFiles.some((f) => FEATURE_MARKERS.some((m) => f.includes(m)));
    if (!touchesFeature) return; // staged set doesn't include feature — skip

    const prohibited = stagedFiles.filter((f) =>
      PROHIBITED_PATHS.some((p) => f === p || f.startsWith(p + '/')),
    );

    expect(
      prohibited,
      `Staged changes include DealTermsCard AND prohibited files — split into separate commits:\n` +
        prohibited.join('\n'),
    ).toHaveLength(0);
  });

  test('every STAGED deal-terms file is on the permitted list', () => {
    let stagedFiles: string[];
    try {
      const raw = execSync('git diff --name-only --cached', {
        cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      stagedFiles = raw.trim().split('\n').filter(Boolean);
    } catch {
      console.info('[scope-guard] git not available, skipping');
      return;
    }

    if (stagedFiles.length === 0) return;

    const featureFiles = stagedFiles.filter(
      (f) =>
        f.includes('DealTermsCard') ||
        f.includes('useDealTermsAnalysis') ||
        f.includes('deal-terms') ||
        f.includes('MarketAnalysisCard') ||
        f.includes('useMarketAnalysis') ||
        f.includes('market-analysis') ||
        f.includes('FinancialAnalysisSection') ||
        f.includes('useFinancialAnalysis') ||
        f.includes('financial-analysis') ||
        f.includes('RiskVerificationSection') ||
        f.includes('useRiskVerification') ||
        f.includes('risk-verification'),
    );

    for (const f of featureFiles) {
      const isPermitted = PERMITTED_NEW_FILES.some((p) => f === p || f.startsWith(p + '/'));
      expect(
        isPermitted,
        `Unexpected staged file in AI Analysis feature: ${f} — update PERMITTED_NEW_FILES if intentional`,
      ).toBe(true);
    }
  });
});
