# Mock Data & Incorrect Text Audit Report

**Generated:** 2025-12-16 23:07:09

---

## Summary

This report identifies:
- **Hardcoded mock data** that should come from APIs
- **Incorrect/placeholder text** that needs correction
- **API integration gaps** where data should be fetched but isn't
- **Data discrepancies** between different parts of the app

Use this report to systematically fix issues with clear line numbers and file paths.

---

## 1. HARDCODED MOCK DATA

### 1.1 Mock Arrays in Components

Searching for hardcoded mock data arrays...
apps/web/src/components/documents/DocumentLibrary.tsx:56:  const mockDocuments: LibraryDoc[] = [
apps/web/src/components/editor/AIImageGenerator.tsx:33:    const mockImages = [

### 1.2 Hardcoded Object Literals
apps/web/src/components/ui/chart.tsx-220-                      />
--
apps/web/src/components/ui/RiskMapGrid.tsx:31:    {
apps/web/src/components/ui/RiskMapGrid.tsx-32-      category: 'Market Risk',
apps/web/src/components/ui/RiskMapGrid.tsx-33-      severity: 'low',
apps/web/src/components/ui/RiskMapGrid.tsx-34-      icon: TrendingUp,
apps/web/src/components/ui/RiskMapGrid.tsx-35-      description: 'Strong market positioning',
apps/web/src/components/ui/RiskMapGrid.tsx-36-      details: 'Large addressable market ($12B TAM) with clear growth trajectory. Competitive landscape is manageable with strong differentiation.'
--
apps/web/src/components/ui/RiskMapGrid.tsx:38:    {
apps/web/src/components/ui/RiskMapGrid.tsx-39-      category: 'Team Risk',
apps/web/src/components/ui/RiskMapGrid.tsx-40-      severity: 'medium',
apps/web/src/components/ui/RiskMapGrid.tsx-41-      icon: Users,
apps/web/src/components/ui/RiskMapGrid.tsx-42-      description: 'Need technical co-founder',
apps/web/src/components/ui/RiskMapGrid.tsx-43-      details: 'Strong business leadership but lacks technical expertise. Recommend bringing on a CTO with ML/AI background before Series A.'
--
apps/web/src/components/ui/RiskMapGrid.tsx:45:    {
apps/web/src/components/ui/RiskMapGrid.tsx-46-      category: 'Financial Risk',
apps/web/src/components/ui/RiskMapGrid.tsx-47-      severity: 'medium',
apps/web/src/components/ui/RiskMapGrid.tsx-48-      icon: DollarSign,

### 1.3 Hardcoded Company Names
Looking for company names that should come from API...
apps/web/src/components/NewDealModal.tsx:260:                  placeholder="e.g., CloudScale SaaS Investment"
apps/web/src/components/NewDealModal.tsx:273:                  placeholder="e.g., CloudScale Inc."
apps/web/src/components/DashboardContent.tsx:78:      name: 'CloudScale SaaS',
apps/web/src/components/DashboardContent.tsx:79:      company: 'CloudScale Inc.',
apps/web/src/components/DashboardContent.tsx:88:      name: 'TechVision AI',
apps/web/src/components/DashboardContent.tsx:89:      company: 'TechVision Labs',
apps/web/src/components/DashboardContent.tsx:98:      name: 'FinTech Wallet',
apps/web/src/components/DashboardContent.tsx:169:      description: 'CloudScale SaaS moved to GO status',
apps/web/src/components/DashboardContent.tsx:176:      description: 'Due Diligence Report for TechVision AI',
apps/web/src/components/DashboardContent.tsx:254:      description: 'TechVision AI, FinTech Wallet, and HealthTech Platform are waiting for feedback',
apps/web/src/components/DashboardContent.tsx:261:      description: 'TechVision AI due diligence is 2 weeks old',
apps/web/src/components/DashboardContent.tsx:275:      description: 'CloudScale SaaS exceeds benchmarks in 4/5 categories',
apps/web/src/components/DashboardContent.tsx:349:      title: 'CloudScale Due Diligence',
apps/web/src/components/DashboardContent.tsx:356:      title: 'TechVision Investment Memo',
apps/web/src/components/DashboardContent.tsx:404:      title: 'Complete CloudScale due diligence',
apps/web/src/components/DashboardContent.tsx:411:      title: 'Review TechVision financials',
apps/web/src/components/RightSidebar.tsx:68:      description: 'TechVision AI jumped from 82 to 89',
apps/web/src/components/RightSidebar.tsx:79:      description: 'CloudScale moved to "Under Review"',
apps/web/src/components/RightSidebar.tsx:112:      description: 'In TechVision AI deal comments',
apps/web/src/components/RightSidebar.tsx:199:      deal: 'TechVision AI',
apps/web/src/components/RightSidebar.tsx:207:      deal: 'CloudScale',
apps/web/src/components/pages/Team.tsx:31:      target: 'TechVision AI - Due Diligence',
apps/web/src/components/pages/DueDiligenceReport.tsx:58:  const isVintaraDeal = dealId === 'vintara-001';
apps/web/src/components/pages/DueDiligenceReport.tsx:61:  console.log('DueDiligenceReport dealId:', dealId, 'isVintaraDeal:', isVintaraDeal);
apps/web/src/components/pages/DueDiligenceReport.tsx:64:  const dealName = isVintaraDeal ? 'Vintara Group LLC' : 'TechVision AI Platform';
apps/web/src/components/pages/DueDiligenceReport.tsx:65:  const generatedDate = isVintaraDeal ? 'September 5, 2025' : 'December 1, 2024';
apps/web/src/components/pages/DueDiligenceReport.tsx:66:  const lastUpdated = isVintaraDeal ? 'September 5, 2025' : 'December 12, 2024';
apps/web/src/components/pages/DueDiligenceReport.tsx:382:                  Vintara Group LLC is building a spirits "brand accelerator" that centralizes shared infrastructure (compliance, logistics, finance, analytics) while preserving each brand's cultural identity—aiming for <strong>rapid, capital-disciplined growth and exit optionality</strong> with an overall score of 86/100. The company has secured $5M committed equity and is well-positioned for its first brand acquisition.
apps/web/src/components/pages/AIStudio.tsx:295:                    TechVision AI Platform
apps/web/src/components/pages/DealComparison.tsx:80:      name: 'TechVision AI',
apps/web/src/components/pages/ReportsGenerated.tsx:16:      name: 'Vintara Group LLC',
apps/web/src/components/pages/ReportsGenerated.tsx:28:      name: 'TechVision AI Platform',
apps/web/src/components/pages/ReportsGenerated.tsx:176:                        alert('Opening TechVision AI report...');
apps/web/src/components/pages/Analytics.tsx:88:    { id: '1', name: 'TechVision AI Platform', readiness: 87, lastActivity: '2h ago', roi: 2850, trend: 'up', change: 5 },
apps/web/src/components/pages/Profile.tsx:43:    company: 'TechVision AI',
apps/web/src/components/pages/DealWorkspace.tsx:809:                      {dealInfo?.description || dealData?.description || 'TechVision AI is building the next generation of enterprise AI infrastructure, enabling companies to deploy custom AI models at scale. With 2 prior exits and a team from Google, Meta, and OpenAI, we\'re uniquely positioned to capture the $2.5B market opportunity. Currently serving 15 enterprise customers with $850K ARR and 40% MoM growth.'}
apps/web/src/components/pages/DealWorkspace.tsx:867:                  name: 'TechVision AI Platform',
apps/web/src/components/pages/DealWorkspace.tsx:868:                  company: 'TechVision AI',
apps/web/src/components/pages/DealWorkspace.tsx:1023:          itemName={dealData?.name || 'TechVision AI Platform'}
apps/web/src/components/pages/DealWorkspace.tsx:1044:          name: 'TechVision AI Platform',
apps/web/src/components/pages/DealWorkspace.tsx:1045:          company: 'TechVision AI',
apps/web/src/components/report-templates/sections/CompetitiveLandscape.tsx:57:              const isUs = item.company === data.companyName || item.company.includes('TechVision');
apps/web/src/components/onboarding/FirstDealGuide.tsx:189:                    placeholder={isFounder ? "e.g., Your Startup Name" : "e.g., CloudScale SaaS"}
apps/web/src/components/reports/ProfessionalReportGenerator.tsx:312:                {dealData?.name || 'TechVision AI Platform'}
apps/web/src/components/reports/ProfessionalReportGenerator.tsx:383:                    {dealData?.name || 'TechVision AI Platform'}
apps/web/src/components/reports/ProfessionalReportGenerator.tsx:434:                      {dealData?.name || 'TechVision AI Platform'} is seeking {dealData?.fundingAmount || '$5M'} in {dealData?.stage || 'Series A'} funding. 

---

## 2. INCORRECT/PLACEHOLDER TEXT

### 2.1 Email Addresses

Searching for placeholder email addresses...
apps/web/src/setupTests.ts:1:import '@testing-library/jest-dom';
apps/web/src/components/ExportReportModal.tsx:487:                        placeholder="investor@example.com"
apps/web/src/components/reports/ExportOptionsModal.tsx:180:                    placeholder="investor@example.com"
apps/web/src/__tests__/DealWorkspace.test.tsx:1:import { render, screen, waitFor } from '@testing-library/react';
apps/web/src/__tests__/DealWorkspace.test.tsx:2:import userEvent from '@testing-library/user-event';

### 2.2 Fake Phone Numbers
apps/web/src/components/pages/Profile.tsx:45:    phone: '+1 (555) 123-4567',
apps/web/src/components/editor/AIImageGenerator.tsx:41:      { url: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800', alt: 'Innovation' },

### 2.3 Lorem Ipsum / Placeholder Text
apps/web/src/App.tsx:129:    // TODO: Save to backend/localStorage when ready
apps/web/src/components/ui/command.tsx:69:          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
apps/web/src/components/ui/textarea.tsx:30:        "resize-none border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-input-background px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
apps/web/src/components/ui/input.tsx:21:          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base bg-input-background transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
apps/web/src/components/collaboration/CommentsPanel.tsx:383:              placeholder="Write a reply..."
apps/web/src/components/collaboration/CommentsPanel.tsx:387:                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
apps/web/src/components/collaboration/CommentsPanel.tsx:388:                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
apps/web/src/components/collaboration/CommentsPanel.tsx:492:            placeholder={`Add a ${commentType}...`}
apps/web/src/components/collaboration/CommentsPanel.tsx:496:                ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
apps/web/src/components/collaboration/CommentsPanel.tsx:497:                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
apps/web/src/components/collaboration/TeamMembersPanel.tsx:168:              placeholder="Search members..."
apps/web/src/components/collaboration/TeamMembersPanel.tsx:173:                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
apps/web/src/components/collaboration/TeamMembersPanel.tsx:174:                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
apps/web/src/components/collaboration/TeamMembersPanel.tsx:416:                  placeholder="colleague@company.com"
apps/web/src/components/collaboration/TeamMembersPanel.tsx:419:                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
apps/web/src/components/collaboration/TeamMembersPanel.tsx:420:                      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
apps/web/src/components/collaboration/TeamMembersPanel.tsx:488:                placeholder="Add a personal message to the invitation..."
apps/web/src/components/collaboration/TeamMembersPanel.tsx:492:                    ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
apps/web/src/components/collaboration/TeamMembersPanel.tsx:493:                    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
apps/web/src/components/collaboration/ShareModal.tsx:179:                      placeholder="Enter email address"

### 2.4 Hardcoded Status Values
Checking for hardcoded status values instead of dynamic ones...

---

## 3. API INTEGRATION GAPS

### 3.1 Components With No API Calls

Finding components that render data without API calls...
**ui/RiskMapGrid.tsx** - May have hardcoded data rendered
**collaboration/CommentsPanel.tsx** - May have hardcoded data rendered
**LogoShowcase.tsx** - May have hardcoded data rendered
**TemplateEditor.tsx** - May have hardcoded data rendered
**workspace/AnalysisTab.tsx** - May have hardcoded data rendered
**template-previews/PitchDeckPreview.tsx** - May have hardcoded data rendered
**documents/DocumentsTable.tsx** - May have hardcoded data rendered
**ExportReportModal.tsx** - May have hardcoded data rendered
**pages/Templates.tsx** - May have hardcoded data rendered
**pages/Team.tsx** - May have hardcoded data rendered
**pages/AIStudio.tsx** - May have hardcoded data rendered
**pages/ROICalculator.tsx** - May have hardcoded data rendered
**pages/ReportsGenerated.tsx** - May have hardcoded data rendered
**pages/Analytics.tsx** - May have hardcoded data rendered
**pages/Profile.tsx** - May have hardcoded data rendered
**pages/Gamification.tsx** - May have hardcoded data rendered
**TemplateExportModal.tsx** - May have hardcoded data rendered
**report-templates/ReportPreview.tsx** - May have hardcoded data rendered
**editor/AIImageGenerator.tsx** - May have hardcoded data rendered
**onboarding/CelebrationModal.tsx** - May have hardcoded data rendered
**onboarding/ProfileSetup.tsx** - May have hardcoded data rendered
**onboarding/FeatureTour.tsx** - May have hardcoded data rendered
**reports/ExportOptionsModal.tsx** - May have hardcoded data rendered
**reports/ProfessionalReportGenerator.tsx** - May have hardcoded data rendered

### 3.2 Components With Both Mock and Real Data
**documents/DocumentLibrary.tsx** - Has both mock and API data

---

## 4. DATA DISCREPANCIES

### 4.1 Known Discrepancies

Recording known issues for tracking...

#### DocumentsTab Document Count Mismatch
- **File**: `apps/web/src/components/documents/DocumentsTab.tsx`
- **Issue**: Document count showing 0 even when documents exist in database
- **Expected**: Should show actual count from `apiGetDocuments(dealId)`
- **Status**: NEEDS INVESTIGATION

#### DealWorkspace Investment Score
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx` (Line 133)
- **Issue**: Score showing 82 instead of 0 when no analysis run
- **Expected**: Should show 0 when `dealInfo?.score` is undefined
- **Status**: FIXED - Now uses typeof check
- **Fix Applied**: `const displayScore = typeof dealInfo?.score === 'number' ? dealInfo.score : investorScore;`

#### DealWorkspace Empty States
- **File**: `apps/web/src/components/pages/DealWorkspace.tsx`
- **Issue**: Mock data arrays for dueDiligence and feedback
- **Status**: FIXED - Replaced with empty arrays
- **Files**: Lines 257 (dueDiligence), Line 260 (feedback)

---

## 5. PRIORITY FIXES CHECKLIST

### HIGH PRIORITY

- [ ] **DocumentLibrary Mock Data** (Line 60-131)
  - File: `apps/web/src/components/documents/DocumentLibrary.tsx`
  - Issue: Contains hardcoded `mockDocuments` array
  - Action: Keep only the real data mapping logic
  - Command: Review lines 60-131 and remove mock array

- [ ] **Verify All Empty States Display**
  - Files: DealWorkspace.tsx (all tabs)
  - Action: Test that empty state messages appear when no data
  - Status: Needs browser testing

- [ ] **Document Count Display Bug**
  - File: `apps/web/src/components/documents/DocumentsTab.tsx`
  - Issue: Count shows 0 instead of actual number
  - Action: Debug apiGetDocuments response
  - Expected: Should match database count

### MEDIUM PRIORITY

- [ ] **DashboardContent Hardcoded Deals**
  - File: `apps/web/src/components/DashboardContent.tsx`
  - Issue: May have hardcoded "Active Deals" section
  - Action: Scan for hardcoded deal names/data
  
- [ ] **Report Cards**
  - File: `apps/web/src/components/pages/DealWorkspace.tsx`
  - Issue: Reports tab had hardcoded cards
  - Status: FIXED - Replaced with empty state

### LOW PRIORITY

- [ ] **Review all display values** for consistency with API

---

## 6. HOW TO USE THIS REPORT

### For Each Item:

1. **Identify**: Use file path and line numbers
2. **Categorize**: Is it mock data, text, or API gap?
3. **Document**: Add specific line numbers and context
4. **Fix**: Replace with API call or correct value
5. **Verify**: Test in browser that it displays correctly

### Workflow:

```bash
# 1. Find the issue in this report
# 2. Open the file mentioned
# 3. Look at the specific line numbers
# 4. Make the fix
# 5. Re-run this audit to verify:
./scripts/audit-mock-data.sh
# 6. Compare with previous report
```

---

**Next Steps**: Run specific audits for each component area using the patterns above.

