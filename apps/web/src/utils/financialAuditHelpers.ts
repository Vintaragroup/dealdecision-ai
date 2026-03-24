// Financial Audit Helper Functions

import { ConfidenceLevel, AuditStatus, ImpactSeverity } from '../types/financialAudit';

/**
 * Get color classes for audit status
 */
export function getStatusColor(status: AuditStatus, darkMode: boolean = true): string {
  if (status === 'READY') {
    return darkMode 
      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
      : 'bg-emerald-100 text-emerald-700 border-emerald-300';
  }
  if (status === 'PARTIAL') {
    return darkMode 
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
      : 'bg-amber-100 text-amber-700 border-amber-300';
  }
  return darkMode 
    ? 'bg-red-500/20 text-red-400 border-red-500/30' 
    : 'bg-red-100 text-red-700 border-red-300';
}

/**
 * Get color classes for confidence level
 */
export function getConfidenceColor(confidence: ConfidenceLevel, darkMode: boolean = true): string {
  if (confidence === 'High') {
    return darkMode ? 'text-emerald-400' : 'text-emerald-600';
  }
  if (confidence === 'Medium') {
    return darkMode ? 'text-amber-400' : 'text-amber-600';
  }
  return darkMode ? 'text-red-400' : 'text-red-600';
}

/**
 * Get color classes for support status
 */
export function getSupportStatusColor(status: string, darkMode: boolean = true): string {
  if (status === 'Supported') {
    return darkMode 
      ? 'bg-emerald-500/10 text-emerald-400' 
      : 'bg-emerald-50 text-emerald-700';
  }
  if (status === 'Single Source') {
    return darkMode 
      ? 'bg-amber-500/10 text-amber-400' 
      : 'bg-amber-50 text-amber-700';
  }
  return darkMode 
    ? 'bg-red-500/10 text-red-400' 
    : 'bg-red-50 text-red-700';
}

/**
 * Get visual source weight indicator (dots)
 */
export function getSourceWeight(weight: number): string {
  const filled = '●'.repeat(Math.min(weight, 5));
  const empty = '○'.repeat(Math.max(0, 5 - weight));
  return filled + empty;
}

/**
 * Get color for source weight
 */
export function getSourceWeightColor(weight: number, darkMode: boolean = true): string {
  if (weight >= 4) {
    return darkMode ? 'text-emerald-400' : 'text-emerald-600';
  }
  if (weight >= 3) {
    return darkMode ? 'text-amber-400' : 'text-amber-600';
  }
  return darkMode ? 'text-red-400' : 'text-red-600';
}

/**
 * Get color for impact severity
 */
export function getImpactColor(severity: ImpactSeverity, darkMode: boolean = true): string {
  if (severity === 'high') {
    return darkMode ? 'text-red-400' : 'text-red-600';
  }
  if (severity === 'medium') {
    return darkMode ? 'text-amber-400' : 'text-amber-600';
  }
  return darkMode ? 'text-blue-400' : 'text-blue-600';
}

/**
 * Get card gradient background class
 */
export function getCardBackground(darkMode: boolean = true): string {
  return darkMode
    ? 'bg-gradient-to-br from-[#121821] to-[#1A222C] border-white/10'
    : 'bg-gradient-to-br from-white to-gray-50 border-gray-200';
}

/**
 * Get base background color
 */
export function getBaseBackground(darkMode: boolean = true): string {
  return darkMode ? 'bg-[#0B0F14]' : 'bg-gray-50';
}

/**
 * Get text color classes
 */
export function getTextColors(darkMode: boolean = true) {
  return {
    primary: darkMode ? 'text-[#E5E7EB]' : 'text-gray-900',
    secondary: darkMode ? 'text-[#9CA3AF]' : 'text-gray-600',
    muted: darkMode ? 'text-gray-500' : 'text-gray-500',
  };
}

/**
 * Format completeness score color
 */
export function getCompletenessColor(score: number, darkMode: boolean = true): string {
  if (score >= 80) {
    return darkMode ? 'text-emerald-400' : 'text-emerald-600';
  }
  if (score >= 50) {
    return darkMode ? 'text-amber-400' : 'text-amber-600';
  }
  return darkMode ? 'text-red-400' : 'text-red-600';
}

/**
 * Get conflict background color
 */
export function getConflictBackground(darkMode: boolean = true): string {
  return darkMode
    ? 'bg-red-500/5 border-red-500/20'
    : 'bg-red-50 border-red-200';
}

/**
 * Get warning background color
 */
export function getWarningBackground(darkMode: boolean = true): string {
  return darkMode
    ? 'bg-amber-500/5 border-amber-500/20'
    : 'bg-amber-50 border-amber-200';
}

/**
 * Get single source background color
 */
export function getSingleSourceBackground(darkMode: boolean = true): string {
  return darkMode
    ? 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'
    : 'bg-amber-50/50 border-amber-200 hover:bg-amber-50';
}

/**
 * Get severity badge color
 */
export function getSeverityBadgeColor(severity: 'critical' | 'validation' | 'info', darkMode: boolean = true): string {
  if (severity === 'critical') {
    return darkMode
      ? 'bg-red-500/20 text-red-400'
      : 'bg-red-100 text-red-700';
  }
  if (severity === 'validation') {
    return darkMode
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-amber-100 text-amber-700';
  }
  return darkMode
    ? 'bg-blue-500/20 text-blue-400'
    : 'bg-blue-100 text-blue-700';
}

/**
 * Calculate completeness score from metrics
 */
export function calculateCompletenessScore(
  criticalMetricsPresent: number,
  criticalMetricsTotal: number,
  conflictCount: number,
  highConfidenceCount: number,
  totalMetrics: number
): number {
  const metricScore = (criticalMetricsPresent / criticalMetricsTotal) * 40;
  const confidenceScore = (highConfidenceCount / totalMetrics) * 30;
  const conflictPenalty = Math.min(conflictCount * 5, 20);
  const periodScore = 20; // Simplified for now
  
  return Math.round(metricScore + confidenceScore - conflictPenalty + periodScore);
}

/**
 * Determine overall audit status
 */
export function determineAuditStatus(
  completenessScore: number,
  conflictCount: number,
  criticalMissing: number
): AuditStatus {
  if (criticalMissing > 0 || conflictCount >= 3) {
    return 'WARNING';
  }
  if (completenessScore >= 80 && conflictCount === 0) {
    return 'READY';
  }
  return 'PARTIAL';
}
