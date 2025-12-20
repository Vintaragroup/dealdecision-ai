/**
 * Analyzer Registry - creates and manages all analyzers
 */

import { SlideSequenceAnalyzer } from './slide-sequence.js';
import { MetricBenchmarkValidator } from './metric-benchmark.js';
import { VisualDesignScorer } from './visual-design.js';
import { NarrativeArcDetector } from './narrative-arc.js';
import { FinancialHealthCalculator } from './financial-health.js';
import { RiskAssessmentEngine } from './risk-assessment.js';

export interface AnalyzerRegistry {
  slideSequence: SlideSequenceAnalyzer;
  metricBenchmark: MetricBenchmarkValidator;
  visualDesign: VisualDesignScorer;
  narrativeArc: NarrativeArcDetector;
  financialHealth: FinancialHealthCalculator;
  riskAssessment: RiskAssessmentEngine;
}

/**
 * Create analyzer registry with all analyzers initialized
 * Each analyzer will create its own LLM service instance if needed
 */
export function createAnalyzerRegistry(): AnalyzerRegistry {
  return {
    slideSequence: new SlideSequenceAnalyzer(),
    metricBenchmark: new MetricBenchmarkValidator(),
    visualDesign: new VisualDesignScorer(),
    narrativeArc: new NarrativeArcDetector(),
    financialHealth: new FinancialHealthCalculator(),
    riskAssessment: new RiskAssessmentEngine(),
  };
}
