/**
 * End-to-End Integration Test
 * 
 * Tests the complete orchestration pipeline with real database data
 */

import { DealOrchestrator } from '../orchestration/orchestrator';
import { MockDIOStorage } from '../services/dio-storage';
import type { OrchestrationInput } from '../orchestration/orchestrator';
import { compileDIOToReport } from '../reports/compiler-simple';
import fs from 'node:fs';
import path from 'node:path';

// Analyzers
import { SlideSequenceAnalyzer } from '../analyzers/slide-sequence';
import { MetricBenchmarkValidator } from '../analyzers/metric-benchmark';
import { VisualDesignScorer } from '../analyzers/visual-design';
import { NarrativeArcDetector } from '../analyzers/narrative-arc';
import { FinancialHealthCalculator } from '../analyzers/financial-health';
import { RiskAssessmentEngine } from '../analyzers/risk-assessment';

describe('End-to-End Integration Test', () => {
  let orchestrator: DealOrchestrator;
  let storage: MockDIOStorage;

  beforeEach(() => {
    storage = new MockDIOStorage();
    
    orchestrator = new DealOrchestrator(
      {
        slideSequence: new SlideSequenceAnalyzer(),
        metricBenchmark: new MetricBenchmarkValidator(),
        visualDesign: new VisualDesignScorer(),
        narrativeArc: new NarrativeArcDetector(),
        financialHealth: new FinancialHealthCalculator(),
        riskAssessment: new RiskAssessmentEngine(),
      },
      storage
    );
  });

  describe('WebMax Deal Analysis', () => {
    it('should analyze WebMax pitch deck and generate complete DIO', async () => {
      // Simulate extracted document data for WebMax
      const input: OrchestrationInput = {
        deal_id: 'a596aae1-db29-4085-82d3-4dc07e918d7e',
        analysis_cycle: 1,
        input_data: {
          config: { features: { debug_scoring: true } },
          // The current orchestrator derives analyzer inputs from `documents`.
          documents: [
            {
              fileName: 'WebMax Pitch Deck.pdf',
              totalPages: 15,
              fileSizeBytes: 4_200_000,
              totalWords: 3_000,
              mainHeadings: [
                'WebMax Overview',
                'Problem Statement',
                'Our Solution',
                'Market Opportunity',
                'Business Model',
                'Traction',
                'Team',
                'Financial Projections',
                'Competition',
                'Go-to-Market Strategy',
                'Technology Stack',
                'Use of Funds',
                'Milestones',
                'Investment Terms',
                'Contact',
              ],
              keyMetrics: [
                { key: 'runway', value: '4', source: 'deck' },
                { key: 'burn_rate', value: '200000', source: 'deck' },
                { key: 'revenue', value: 'Revenue: $2,000,000', source: 'deck' },
                { key: 'growth_rate', value: 'Growth: 15%', source: 'deck' },
                { key: 'gross_margin', value: 'Gross Margin: 80%', source: 'deck' },
                { key: 'ltv', value: 'LTV: $50,000', source: 'deck' },
                { key: 'cac', value: 'CAC: $5,000', source: 'deck' },
              ],
              textSummary:
                'WebMax is building the future of web optimization. We are pre-revenue with an MVP. This is a crowded market with many competitors. We are raising $5M.',
            },
          ],
        },
      };

      console.log('\n=== Starting WebMax Deal Analysis ===\n');

      const result = await orchestrator.analyze(input);

      console.log('\n=== Analysis Complete ===');
      
      // Assertions
      expect(result.success).toBe(true);
      expect(result.dio).toBeDefined();
      
      if (!result.dio) {
        throw new Error('DIO was not generated');
      }
      
      console.log('DIO ID:', result.dio.dio_id);
      console.log('Deal ID:', result.dio.deal_id);
      console.log('Schema Version:', result.dio.schema_version);
      console.log('\nAnalyzer Results:');
      console.log('- Slide Sequence Score:', result.dio.analyzer_results.slide_sequence.score);
      console.log('- Metric Benchmark Score:', result.dio.analyzer_results.metric_benchmark.overall_score);
      console.log('- Visual Design Score:', result.dio.analyzer_results.visual_design.design_score);
      console.log('- Narrative Arc:', result.dio.analyzer_results.narrative_arc.archetype);
      console.log('- Financial Health Score:', result.dio.analyzer_results.financial_health.health_score);
      console.log('- Overall Risk Score:', result.dio.analyzer_results.risk_assessment.overall_risk_score);
      console.log('\nDecision:', result.dio.decision.recommendation);
      console.log('Confidence:', result.dio.decision.confidence);

      expect(result.dio.deal_id).toBe('a596aae1-db29-4085-82d3-4dc07e918d7e');
      expect(result.dio.schema_version).toBe('1.0.0');

      // Verify all analyzers ran
      expect(result.dio.analyzer_results.slide_sequence).toBeDefined();
      expect(result.dio.analyzer_results.metric_benchmark).toBeDefined();
      expect(result.dio.analyzer_results.visual_design).toBeDefined();
      expect(result.dio.analyzer_results.narrative_arc).toBeDefined();
      expect(result.dio.analyzer_results.financial_health).toBeDefined();
      expect(result.dio.analyzer_results.risk_assessment).toBeDefined();

      // Verify deterministic debug_scoring rule traces exist for transparency
      const ar: any = result.dio.analyzer_results;
      for (const key of [
        'slide_sequence',
        'metric_benchmark',
        'visual_design',
        'narrative_arc',
        'financial_health',
        'risk_assessment',
      ]) {
        expect(ar[key]).toBeDefined();
        expect(ar[key].debug_scoring).toBeDefined();
        expect(Array.isArray(ar[key].debug_scoring.rules)).toBe(true);
        expect(ar[key].debug_scoring.rules.length).toBeGreaterThan(0);
      }

      // Verify slide sequence detected a reasonable pattern
      expect(result.dio.analyzer_results.slide_sequence.status).toMatch(/^(ok|insufficient_data|extraction_failed)$/);
      if (result.dio.analyzer_results.slide_sequence.status === 'ok') {
        expect(result.dio.analyzer_results.slide_sequence.sequence_detected.length).toBeGreaterThan(0);
        expect(result.dio.analyzer_results.slide_sequence.score).not.toBeNull();
      } else {
        expect(result.dio.analyzer_results.slide_sequence.score).toBeNull();
      }

      // Verify metrics were analyzed
      expect(result.dio.analyzer_results.metric_benchmark.status).toMatch(/^(ok|insufficient_data|extraction_failed)$/);
      if (result.dio.analyzer_results.metric_benchmark.status === 'ok') {
        expect(result.dio.analyzer_results.metric_benchmark.overall_score).not.toBeNull();
      } else {
        expect(result.dio.analyzer_results.metric_benchmark.overall_score).toBeNull();
      }
      
      // Verify financial health
      expect(result.dio.analyzer_results.financial_health.status).toMatch(/^(ok|insufficient_data|extraction_failed)$/);
      if (result.dio.analyzer_results.financial_health.status === 'ok') {
        expect(result.dio.analyzer_results.financial_health.health_score).not.toBeNull();
      } else {
        expect(result.dio.analyzer_results.financial_health.health_score).toBeNull();
      }

      // Verify risk assessment
      expect(result.dio.analyzer_results.risk_assessment.status).toMatch(/^(ok|insufficient_data|extraction_failed)$/);
      if (result.dio.analyzer_results.risk_assessment.status === 'ok') {
        expect(result.dio.analyzer_results.risk_assessment.overall_risk_score).not.toBeNull();
      } else {
        expect(result.dio.analyzer_results.risk_assessment.overall_risk_score).toBeNull();
      }
      expect(result.dio.analyzer_results.risk_assessment.risks_by_category).toBeDefined();

      // Verify decision was made
      expect(result.dio.decision.recommendation).toMatch(/^(GO|NO-GO|CONDITIONAL)$/);
      expect(result.dio.decision.confidence).toBeGreaterThanOrEqual(0);
      expect(result.dio.decision.confidence).toBeLessThanOrEqual(1);

      // Verify storage
      expect(result.storage_result).toBeDefined();
      expect(result.storage_result!.version).toBe(1);
      expect(result.storage_result!.is_duplicate).toBe(false);
      
      // Verify stored DIO can be retrieved
      const retrieved = await storage.getLatestDIO(input.deal_id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.deal_id).toBe(input.deal_id);
      expect(retrieved!.schema_version).toBe('1.0.0');

      console.log('\n✅ All assertions passed!\n');
    }, 60000); // 60 second timeout

    it('Vintara fixture: debug_scoring.rules are populated and report includes Why this score blocks', async () => {
      const fixturePath = path.resolve(__dirname, '../../../../docs/dio-reports/reports/vintara-group-llc_v4.json');
      if (!fs.existsSync(fixturePath)) {
        console.warn(`Vintara fixture missing at ${fixturePath}; skipping fixture assertion.`);
        return;
      }

      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const dioFromExport = fixture?.latestDio?.dio;
      expect(dioFromExport).toBeDefined();

      const docs = dioFromExport.inputs?.documents;
      expect(Array.isArray(docs)).toBe(true);
      expect(docs.length).toBeGreaterThan(0);

      const input: OrchestrationInput = {
        deal_id: String(fixture?.deal?.id ?? dioFromExport.deal_id ?? 'vintara-fixture-deal'),
        analysis_cycle: 1,
        input_data: {
          config: { features: { debug_scoring: true } },
          documents: docs,
        },
      };

      const result = await orchestrator.analyze(input);
      expect(result.success).toBe(true);
      expect(result.dio).toBeDefined();
      if (!result.dio) throw new Error('DIO was not generated');

      const ar: any = result.dio.analyzer_results;
      for (const key of [
        'slide_sequence',
        'metric_benchmark',
        'visual_design',
        'narrative_arc',
        'financial_health',
        'risk_assessment',
      ]) {
        expect(ar[key]).toBeDefined();
        expect(ar[key].debug_scoring).toBeDefined();
        expect(Array.isArray(ar[key].debug_scoring.rules)).toBe(true);
        expect(ar[key].debug_scoring.rules.length).toBeGreaterThan(0);
      }

      const report = compileDIOToReport(result.dio as any);
      expect(report).toBeDefined();
      const sectionText = report.sections.map((s) => s.content).join('\n');
      expect(sectionText).toContain('Why this score?');
    }, 60000);

    it('should handle minimal input gracefully', async () => {
      const minimalInput: OrchestrationInput = {
        deal_id: 'test-minimal-deal',
        analysis_cycle: 1,
        input_data: {
          slideSequence: {
            headings: ['Title'],
          },
          metricBenchmark: {
            text: 'No metrics available',
          },
          visualDesign: {
            page_count: 1,
            images_count: 0,
            charts_count: 0,
            has_consistent_branding: false,
          },
          narrativeArc: {
            slides: [{ heading: 'Title', text: 'Content' }],
          },
          financialHealth: {
            revenue: null,
            expenses: null,
            cash_balance: null,
            burn_rate: null,
            growth_rate: null,
          },
          riskAssessment: {
            pitch_text: 'Minimal pitch',
            headings: ['Title'],
            metrics: {},
            team_size: 0,
          },
        },
      };

      const result = await orchestrator.analyze(minimalInput);

      expect(result.success).toBe(true);
      expect(result.dio).toBeDefined();
      
      if (!result.dio) {
        throw new Error('DIO was not generated');
      }
      
      // Should still produce results even with minimal input
      expect(result.dio.analyzer_results.slide_sequence.score).toBeDefined();
      expect(result.dio.analyzer_results.financial_health.health_score).toBeDefined();
      expect(result.dio.decision.recommendation).toBeDefined();
    }, 30000);
  });
});
