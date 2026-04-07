import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { FileText, BarChart3 } from 'lucide-react';
import { QuickStatsBar } from './widgets/QuickStatsBar';
import { ActiveDealsWidget } from './widgets/ActiveDealsWidget';
import { ActivityFeed } from './widgets/ActivityFeed';
import { RecentDocumentsWidget } from './widgets/RecentDocumentsWidget';
import { QuickLinksWidget, QuickLink } from './widgets/QuickLinksWidget';
import type { PageView } from './Sidebar';
import { useAppSettings } from '../contexts/AppSettingsContext';
import { useUserRole } from '../contexts/UserRoleContext';
import { useAuth, useUser } from '@clerk/clerk-react';
import { apiGetDeals, apiGetDocuments } from '../lib/apiClient';

type RecentDocItem = {
  id: string;
  title: string;
  type: string;
  lastModified: string;
  status?: 'draft' | 'final' | 'in-review';
};

type ActivityItem = {
  id: string;
  type: 'deal' | 'document';
  title: string;
  description: string;
  timestamp: string;
};

function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diffMs = Date.now() - t;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function normalizeDocStatus(raw: unknown): 'draft' | 'final' | 'in-review' | undefined {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!s) return undefined;
  if (s.includes('final')) return 'final';
  if (s.includes('review')) return 'in-review';
  return 'draft';
}

interface DashboardContentProps {
  darkMode: boolean;
  onNavigate?: (page: PageView) => void;
  onDealClick?: (dealId: string) => void;
  onNewDeal?: () => void;
}

export function DashboardContent({ darkMode, onNavigate, onDealClick, onNewDeal }: DashboardContentProps) {
  const { settings } = useAppSettings();
  const { isAnalyst, isInvestor } = useUserRole();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth();

  const [allDeals, setAllDeals] = useState<any[]>([]);
  const [activeDeals, setActiveDeals] = useState<any[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocItem[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

  const loadDeals = useCallback(async () => {
    setLoadingDeals(true);
    try {
      const deals = await apiGetDeals();
      const normalizedDeals = deals || [];
      setAllDeals(normalizedDeals);

      // Limit to first 4 deals for dashboard display, transform API data to match UI format
      const displayDeals = normalizedDeals
        .slice(0, 4)
        .map((deal: any) => {
          const dealId = deal?.id ?? deal?.deal_id ?? deal?.dealId ?? deal?.dealID;
          const score = Number(deal?.score ?? deal?.overall_score ?? 0) || 0;
          const fundabilityV1 = deal?.fundability_v1 && typeof deal.fundability_v1 === 'object' ? deal.fundability_v1 : null;
          return {
            id: String(dealId ?? ''),
            name: deal?.name || 'Unknown Deal',
            company: (deal?.company ?? deal?.company_name ?? deal?.companyName ?? deal?.name) || 'Unknown Company',
            score,
            // TODO [CANONICAL-MIGRATION P2]: status derived from raw list score.
            // canonical_decision is not available here (requires per-deal orchestrator-report fetch).
            // Migrate when the /deals list endpoint can return canonical_decision summary.
            status: score >= 75 ? 'go' : score >= 50 ? 'hold' : 'no-go',
            stage: deal?.stage || 'intake',
            lastUpdated: 'Recently',
            trend: 'up' as const,

			// Additive: Analysis Foundation fundability summary (if present).
			fundability_v1: fundabilityV1,
          };
        })
        .filter((d: any) => typeof d.id === 'string' && d.id.length > 0);
      setActiveDeals(displayDeals);

      // Recent documents (best-effort): pull from a few deals to populate dashboard.
      const dealIdList = normalizedDeals
        .map((d: any) => String(d?.id ?? d?.deal_id ?? ''))
        .filter((id: string) => id.length > 0)
        .slice(0, 6);
      const dealNameById = new Map<string, string>(
        normalizedDeals
          .map((d: any) => [String(d?.id ?? d?.deal_id ?? ''), String(d?.name ?? 'Deal')] as const)
          .filter((entry): entry is readonly [string, string] => {
            const [id] = entry;
            return typeof id === 'string' && id.length > 0;
          })
      );

      const docResults = await Promise.allSettled(dealIdList.map((dealId) => apiGetDocuments(dealId)));
      const docs = docResults
        .flatMap((r, idx) => {
          if (r.status !== 'fulfilled') return [];
          const dealId = dealIdList[idx];
          return (r.value?.documents ?? []).map((doc) => ({ ...doc, deal_id: dealId }));
        })
        .filter((d: any) => d && typeof d.document_id === 'string');

      docs.sort((a: any, b: any) => {
        const at = a.uploaded_at ? Date.parse(a.uploaded_at) : 0;
        const bt = b.uploaded_at ? Date.parse(b.uploaded_at) : 0;
        return bt - at;
      });

      const recentDocs: RecentDocItem[] = docs.slice(0, 5).map((d: any) => ({
        id: String(d.document_id),
        title: String(d.title ?? 'Untitled'),
        type: String(d.type ?? 'Document'),
        lastModified: formatRelativeTime(d.uploaded_at),
        status: normalizeDocStatus(d.status),
      }));
      setRecentDocuments(recentDocs);

      const activity: ActivityItem[] = docs.slice(0, 6).map((d: any) => {
        const dealName = dealNameById.get(String(d.deal_id)) || 'a deal';
        return {
          id: String(d.document_id),
          type: 'document',
          title: 'Document uploaded',
          description: `${String(d.title ?? 'Untitled')} → ${dealName}`,
          timestamp: formatRelativeTime(d.uploaded_at),
        };
      });
      setRecentActivity(activity);
    } catch (error) {
      console.error('Failed to load deals:', error);
      setAllDeals([]);
      setActiveDeals([]);
      setRecentDocuments([]);
      setRecentActivity([]);
    } finally {
      setLoadingDeals(false);
    }
  }, []);

  // Fetch deals from API
  useEffect(() => {
    if (!authLoaded) return;

    // Never call the backend until an active org exists.
    if (!isSignedIn || !orgId) {
      setLoadingDeals(false);
      setAllDeals([]);
      setActiveDeals([]);
      setRecentDocuments([]);
      setRecentActivity([]);
      return;
    }

    // Investor + Analyst share the same deal-evaluation experience
    loadDeals();
  }, [authLoaded, isSignedIn, orgId, loadDeals, isInvestor, isAnalyst]);
  
  const numericScores = allDeals
    .map((d: any) => {
      const score = d?.score;
      return typeof score === 'number' && Number.isFinite(score) ? score : null;
    })
    .filter((x: number | null): x is number => x != null);
  const avgScore = numericScores.length > 0 ? Math.round(numericScores.reduce((a, b) => a + b, 0) / numericScores.length) : null;
  const inDiligenceCount = allDeals.filter((d: any) => String(d?.stage ?? '').toLowerCase() === 'in_diligence').length;
  const decisionReadyCount = allDeals.filter((d: any) => {
    const s = String(d?.stage ?? '').toLowerCase();
    return s === 'ready_decision' || s === 'decision_ready';
  }).length;

  const quickStats = [
    { id: 'stat-active-deals', label: 'Active Deals', value: allDeals.length, icon: 'deals' as const },
    { id: 'stat-in-diligence', label: 'In Diligence', value: inDiligenceCount, icon: 'deals' as const },
    { id: 'stat-decision-ready', label: 'Decision Ready', value: decisionReadyCount, icon: 'deals' as const },
    { id: 'stat-avg-score', label: 'Avg Score', value: avgScore == null ? '—' : `${avgScore}%`, icon: 'growth' as const },
  ];

  const quickLinks: QuickLink[] = [
    {
      id: '1',
      title: 'Due Diligence Report',
      description: 'Generate AI-powered DD',
      icon: 'document' as const,
      action: 'documents'
    },
    {
      id: '2',
      title: 'Investment Team',
      description: 'Collaborate with partners',
      icon: 'team' as const,
      action: 'team'
    },
    {
      id: '3',
      title: 'AI Analysis',
      description: 'Deep dive with AI Studio',
      icon: 'ai' as const,
      action: 'aiStudio'
    },
    {
      id: '4',
      title: 'Portfolio Dashboard',
      description: 'View performance metrics',
      icon: 'analytics' as const,
      action: 'analytics'
    }
  ];

  const displayName = (() => {
    if (!isUserLoaded) return 'there';
    const full = typeof user?.fullName === 'string' ? user.fullName.trim() : '';
    if (full) return full;
    const first = typeof user?.firstName === 'string' ? user.firstName.trim() : '';
    if (first) return first;
    const email = user?.primaryEmailAddress?.emailAddress;
    return typeof email === 'string' && email.trim().length > 0 ? email.trim() : 'there';
  })();

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className={`text-xl md:text-2xl mb-1 bg-gradient-to-r bg-clip-text text-transparent ${
            darkMode ? 'from-white to-white/70' : 'from-gray-900 to-gray-700'
          }`}>
            Welcome back, {displayName}! 👋
          </h1>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Here's what's happening with your deals today
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            className="gap-2 text-sm"
            onClick={() => onNavigate?.('documents')}
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Documents</span>
          </Button>
          <Button 
            variant="outline"
            className="gap-2 text-sm"
            onClick={() => onNavigate?.('analytics')}
          >
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Analytics</span>
          </Button>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <QuickStatsBar darkMode={darkMode} stats={quickStats} />

      {/* Main Grid - 3 Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 md:gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Quick Links */}
          <QuickLinksWidget 
            darkMode={darkMode}
            links={quickLinks}
            onLinkClick={(linkId) => {
              const link = quickLinks.find(l => l.id === linkId);
              if (link) onNavigate?.(link.action as PageView);
            }}
            title="Quick Actions"
          />

          {/* Active Deals */}
          <ActiveDealsWidget 
            darkMode={darkMode} 
            deals={activeDeals.slice(0, 4)} 
            onDealClick={onDealClick}
          />
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Activity Feed (live-backed) */}
          <ActivityFeed
            darkMode={darkMode}
            activities={recentActivity}
            onActivityClick={(activityId, type) => {
              if (type === 'document') onNavigate?.('documents');
              if (type === 'deal') onNavigate?.('dealsList');
            }}
          />

          {/* Recent Documents */}
          <RecentDocumentsWidget 
            darkMode={darkMode}
            documents={recentDocuments}
            onDocumentClick={(docId) => onNavigate?.('documents')}
            onViewAll={() => onNavigate?.('documents')}
            title="Recent Documents"
          />
        </div>
      </div>

      {/* Quick Action Bar - Bottom Sticky */}
      {/* Removed - Replaced with global chat assistant */}
    </div>
  );
}