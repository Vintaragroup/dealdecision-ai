import { AlertTriangle, RefreshCw, FileQuestion } from 'lucide-react';

interface ErrorStateProps {
  darkMode: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

/**
 * ERROR STATE COMPONENTS FOR INVESTOR INSIGHTS TAB
 * 
 * Provides user-friendly error messages and retry functionality
 */

// ============================================================================
// MAIN ERROR STATE
// ============================================================================

export function InvestorInsightsError({ darkMode, error, onRetry }: ErrorStateProps) {
  const errorMessage = error?.message || 'An unexpected error occurred';

  return (
    <div className={`min-h-[600px] flex items-center justify-center p-8 rounded-xl border backdrop-blur-xl ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="text-center max-w-md">
        {/* Error Icon */}
        <div className={`w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center ${
          darkMode ? 'bg-red-500/10' : 'bg-red-50'
        }`}>
          <AlertTriangle className="w-10 h-10 text-red-500" />
        </div>

        {/* Error Title */}
        <h3 className={`text-2xl font-semibold mb-3 ${
          darkMode ? 'text-white' : 'text-gray-900'
        }`}>
          Failed to Load Insights
        </h3>

        {/* Error Message */}
        <p className={`text-sm mb-6 leading-relaxed ${
          darkMode ? 'text-gray-400' : 'text-gray-600'
        }`}>
          {errorMessage}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white font-medium hover:shadow-lg transition-all flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          )}
          
          <button
            onClick={() => window.location.reload()}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              darkMode 
                ? 'bg-white/10 text-white hover:bg-white/20' 
                : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
            }`}
          >
            Reload Page
          </button>
        </div>

        {/* Help Text */}
        <p className={`text-xs mt-6 ${
          darkMode ? 'text-gray-500' : 'text-gray-400'
        }`}>
          If the problem persists, please contact support.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// EMPTY STATE (No Insights Generated Yet)
// ============================================================================

export function InvestorInsightsEmpty({ darkMode }: { darkMode: boolean }) {
  return (
    <div className={`min-h-[600px] flex items-center justify-center p-8 rounded-xl border backdrop-blur-xl ${
      darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
    }`}>
      <div className="text-center max-w-md">
        {/* Empty Icon */}
        <div className={`w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center ${
          darkMode ? 'bg-[#6366f1]/10' : 'bg-[#6366f1]/5'
        }`}>
          <FileQuestion className="w-10 h-10 text-[#6366f1]" />
        </div>

        {/* Empty Title */}
        <h3 className={`text-2xl font-semibold mb-3 ${
          darkMode ? 'text-white' : 'text-gray-900'
        }`}>
          No Insights Available
        </h3>

        {/* Empty Message */}
        <p className={`text-sm mb-6 leading-relaxed ${
          darkMode ? 'text-gray-400' : 'text-gray-600'
        }`}>
          Insights have not been generated for this deal yet. Upload deal documents to get started.
        </p>

        {/* Help Text */}
        <p className={`text-xs mt-6 ${
          darkMode ? 'text-gray-500' : 'text-gray-400'
        }`}>
          Insights are automatically generated when you upload pitch decks, financial models, and other deal documents.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// PARTIAL ERROR BANNER (Some Data Failed to Load)
// ============================================================================

export function PartialErrorBanner({ 
  darkMode, 
  onDismiss 
}: { 
  darkMode: boolean; 
  onDismiss: () => void;
}) {
  return (
    <div className={`p-4 rounded-lg border mb-4 ${
      darkMode 
        ? 'bg-amber-500/10 border-amber-500/30' 
        : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className={`text-sm font-medium mb-1 ${
            darkMode ? 'text-amber-400' : 'text-amber-900'
          }`}>
            Partial Data Available
          </h4>
          <p className={`text-xs ${
            darkMode ? 'text-amber-300' : 'text-amber-800'
          }`}>
            Some insights could not be loaded. Showing available data.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className={`text-xs font-medium ${
            darkMode ? 'text-amber-400 hover:text-amber-300' : 'text-amber-900 hover:text-amber-800'
          }`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// STALE DATA BANNER (Cached/Outdated Data Warning)
// ============================================================================

export function StaleDataBanner({ 
  darkMode, 
  lastUpdated, 
  onRefresh 
}: { 
  darkMode: boolean; 
  lastUpdated: string;
  onRefresh: () => void;
}) {
  return (
    <div className={`p-4 rounded-lg border mb-4 ${
      darkMode 
        ? 'bg-blue-500/10 border-blue-500/30' 
        : 'bg-blue-50 border-blue-200'
    }`}>
      <div className="flex items-start gap-3">
        <RefreshCw className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className={`text-sm font-medium mb-1 ${
            darkMode ? 'text-blue-400' : 'text-blue-900'
          }`}>
            Data May Be Outdated
          </h4>
          <p className={`text-xs ${
            darkMode ? 'text-blue-300' : 'text-blue-800'
          }`}>
            Insights last updated {new Date(lastUpdated).toLocaleString()}. Click refresh to get the latest analysis.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
            darkMode 
              ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30' 
              : 'bg-blue-100 text-blue-900 hover:bg-blue-200'
          }`}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
