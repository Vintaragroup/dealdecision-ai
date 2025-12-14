# User Role System - Investor vs Founder

## Overview
Implemented a user role toggle system that allows users to switch between "Investor" (default) and "Founder" modes, customizing their entire experience based on their primary use case.

## Implementation Status

### ✅ Phase 1 - Complete
1. **UserRoleContext** (`/contexts/UserRoleContext.tsx`) - ✅ Created
   - Manages role state (`investor` | `founder`)
   - Persists to localStorage
   - Provides `isInvestor` and `isFounder` boolean helpers

2. **App.tsx** - ✅ Updated
   - Wrapped with `UserRoleProvider`

3. **Settings Page** (`/components/pages/Settings.tsx`) - ✅ Updated
   - Added User Role selector in Account tab
   - Visual role cards with icons (💼 Investor, 🚀 Founder)
   - Shows current role and its implications

4. **Sidebar** (`/components/Sidebar.tsx`) - ✅ Updated
   - Role-specific navigation labels
   - "New Deal" → "New Company" (Founder)
   - "Deal Pipeline" vs "My Companies"
   - "Documents" vs "Pitch Materials"
   - "Portfolio Analytics" vs "Fundraising Analytics"
   - "Investment Team" vs "Founding Team"
   - "Compare Deals" hidden for Founders (Investor-only)

5. **Header** (`/components/Header.tsx`) - ✅ Updated
   - Role-specific page titles in breadcrumbs
   - Updates dynamically based on current page and role

6. **DashboardContent** (`/components/DashboardContent.tsx`) - ✅ Updated
   - Role-specific widgets

## User Roles

### 💼 Investor (Default)
**Goal:** Evaluate opportunities, deploy capital wisely, manage portfolio  
**Features:**
- Deal pipeline & scoring
- Due diligence reports
- Portfolio analytics
- Deal comparison tools
- Investment memos
- Risk assessment

### 🚀 Founder
**Goal:** Raise capital, create compelling investment materials  
**Features:**
- Pitch deck builder
- Fundraising tracker
- Investor CRM
- Financial projections
- Cap table management
- Data room organization

## Terminology Changes by Role

| Feature | Investor Term | Founder Term |
|---------|--------------|--------------|
| Main List | "Deal Pipeline" | "My Fundraising Rounds" |
| Workspace | "Due Diligence Workspace" | "Pitch Builder" |
| Analytics | "Portfolio Performance" | "Fundraising Progress" |
| Documents | "Investment Memos" | "Pitch Materials" |
| Team | "Investment Team" | "Founding Team" |

## Next Steps
1. Update onboarding flow for role-specific questions
2. Update ROI Calculator messaging by role

## Files Modified
1. `/contexts/UserRoleContext.tsx` (new)
2. `/App.tsx`
3. `/components/pages/Settings.tsx`
4. `/components/Sidebar.tsx` ✅
5. `/components/Header.tsx` ✅
6. `/components/DashboardContent.tsx` ✅

## Files To Modify (Phase 2)
- `/components/onboarding/*` (role-specific onboarding)
- `/components/pages/ROICalculator.tsx` (role-specific messaging)
- `/components/pages/DealsList.tsx` (role-specific content)
- `/components/pages/Analytics.tsx` (role-specific charts) ✅ COMPLETE