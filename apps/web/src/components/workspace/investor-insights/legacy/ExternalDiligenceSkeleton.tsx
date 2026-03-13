/**
 * ExternalDiligenceSkeleton — pulse skeleton for the external due diligence
 * section while the containing report is loading.
 *
 * Used with React.Suspense (or a simple loading-state guard) to avoid blank
 * sections during fetch.
 */

import React from 'react';

interface ExternalDiligenceSkeletonProps {
  darkMode: boolean;
  /** Number of row skeletons to show. Defaults to 3. */
  rows?: number;
}

function SkeletonLine({
  darkMode,
  width = 'full',
  height = 'h-3',
}: {
  darkMode: boolean;
  width?: 'full' | 'w-3/4' | 'w-1/2' | 'w-2/3' | 'w-1/3';
  height?: string;
}) {
  return (
    <div
      className={`${height} rounded ${width === 'full' ? 'w-full' : width} animate-pulse ${
        darkMode ? 'bg-white/8' : 'bg-gray-200'
      }`}
    />
  );
}

function SkeletonCard({ darkMode }: { darkMode: boolean }) {
  return (
    <div
      className={`rounded-lg border p-4 space-y-2.5 ${
        darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
      }`}
    >
      <SkeletonLine darkMode={darkMode} width="w-1/3" height="h-2.5" />
      <SkeletonLine darkMode={darkMode} />
      <SkeletonLine darkMode={darkMode} width="w-3/4" />
      <SkeletonLine darkMode={darkMode} width="w-1/2" />
    </div>
  );
}

export function ExternalDiligenceSkeleton({
  darkMode,
  rows = 3,
}: ExternalDiligenceSkeletonProps) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading external due diligence data">
      {/* Header row skeleton */}
      <div className="flex items-center gap-3">
        <div
          className={`h-5 w-36 rounded-full animate-pulse ${
            darkMode ? 'bg-white/8' : 'bg-gray-200'
          }`}
        />
        <div
          className={`h-3 w-24 rounded animate-pulse ${
            darkMode ? 'bg-white/5' : 'bg-gray-100'
          }`}
        />
      </div>

      {/* Bucket card skeletons */}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} darkMode={darkMode} />
      ))}
    </div>
  );
}
