# DealDecision AI - Website Specification

## Table of Contents
1. [Site Architecture](#site-architecture)
2. [Complete Page Directory](#complete-page-directory)
3. [Color System & CSS Theme](#color-system--css-theme)
4. [Component Hierarchy](#component-hierarchy)
5. [Navigation Structure](#navigation-structure)
6. [Design Tokens](#design-tokens)

---

## Site Architecture

### Information Architecture
```
DealDecision AI Platform
│
├── Public Pages (Unauthenticated)
│   ├── Landing Page
│   ├── Features
│   ├── Pricing
│   ├── About Us
│   ├── Contact
│   ├── Blog
│   ├── Login
│   └── Sign Up
│
└── Application (Authenticated)
    ├── Onboarding Flow
    ├── Dashboard (Home)
    ├── Deals/Companies
    ├── Deal Workspace
    ├── AI Studio
    ├── Templates
    ├── Analytics
    ├── Team & Collaboration
    ├── Settings
    └── Profile
```

---

## Complete Page Directory

### 🌐 PUBLIC PAGES (Marketing Site)

#### 1. **Landing Page** `/`
```typescript
Purpose: Primary marketing page, convert visitors to sign-ups
Sections:
  - Hero section with CTA
  - Value propositions (Investors vs Founders)
  - Feature highlights (6-8 cards)
  - Social proof (testimonials, logos)
  - Pricing preview
  - Demo video/screenshots
  - Final CTA
  - Footer with links
```

#### 2. **Features Page** `/features`
```typescript
Purpose: Detailed feature breakdown
Sections:
  - Hero with feature overview
  - Tab switcher (Investor Features | Founder Features)
  - Feature cards with icons (15-20 features)
  - Interactive demo sections
  - Comparison table (DealDecision vs Traditional)
  - Integration showcase
  - CTA section
```

#### 3. **Pricing Page** `/pricing`
```typescript
Purpose: Display pricing tiers and plans
Sections:
  - Hero with pricing toggle (Monthly/Annual)
  - Pricing cards (3-4 tiers)
    * Free/Trial
    * Professional ($49-99/mo)
    * Team ($199-299/mo)
    * Enterprise (Custom)
  - Feature comparison table
  - ROI calculator preview
  - FAQ section
  - CTA section
```

#### 4. **About Us** `/about`
```typescript
Purpose: Company story and team
Sections:
  - Mission statement
  - Origin story
  - Team member cards
  - Company values
  - Timeline/milestones
  - Press mentions
  - Careers link
```

#### 5. **Contact** `/contact`
```typescript
Purpose: Contact form and information
Sections:
  - Contact form (name, email, company, message)
  - Contact information (email, address)
  - Calendar booking widget
  - Office locations (if applicable)
  - Social media links
```

#### 6. **Blog** `/blog`
```typescript
Purpose: Content marketing and SEO
Sections:
  - Featured post
  - Post grid with filters (All, Investors, Founders, AI, Tips)
  - Pagination
  - Newsletter signup
  - Search functionality
  
Sub-pages:
  - Blog Post: `/blog/[slug]`
  - Category: `/blog/category/[category]`
  - Author: `/blog/author/[author]`
```

#### 7. **Resources** `/resources`
```typescript
Purpose: Educational content and downloads
Sections:
  - Guides & eBooks
  - Templates (free samples)
  - Webinar recordings
  - Case studies
  - Whitepapers
  - Downloadable resources
```

#### 8. **Use Cases** `/use-cases`
```typescript
Purpose: Role-specific use cases
Sub-pages:
  - For Venture Capital: `/use-cases/venture-capital`
  - For Private Equity: `/use-cases/private-equity`
  - For Family Offices: `/use-cases/family-offices`
  - For Founders: `/use-cases/founders`
  - For Accelerators: `/use-cases/accelerators`
```

#### 9. **Login** `/login`
```typescript
Purpose: User authentication
Sections:
  - Email/password form
  - "Forgot password" link
  - SSO options (Google, Microsoft)
  - Sign up link
  - Demo account option
```

#### 10. **Sign Up** `/signup`
```typescript
Purpose: New user registration
Sections:
  - Registration form (name, email, password)
  - Role selection (Investor/Founder)
  - Terms acceptance
  - SSO options
  - Login link
```

#### 11. **Legal Pages**
```typescript
- Terms of Service: `/legal/terms`
- Privacy Policy: `/legal/privacy`
- Cookie Policy: `/legal/cookies`
- Data Processing Agreement: `/legal/dpa`
- Acceptable Use Policy: `/legal/aup`
```

---

### 🔐 APPLICATION PAGES (Authenticated)

#### 12. **Onboarding Flow** `/onboarding`
```typescript
Purpose: First-time user setup
Pages:
  1. Welcome Modal (overlay)
  2. Profile Setup: `/onboarding/profile`
  3. Feature Tour (overlay)
  4. First Deal/Company: `/onboarding/first-deal`
  5. Celebration (overlay)
  
Redirects to: Dashboard after completion
```

#### 13. **Dashboard** `/dashboard` or `/app`
```typescript
Purpose: Main application home page
Layout: Full app shell with sidebar

Investor View Widgets:
  - Welcome header with user stats
  - Active Deals grid (6 cards)
  - Portfolio Performance chart
  - AI Insights & Recommendations
  - Quick Actions bar
  - Recent Activity feed
  - Gamification stats (optional)
  - Notifications panel toggle
  
Founder View Widgets:
  - Welcome header with user stats
  - Company Profile card
  - Pitch Score overview
  - Fundraising Progress
  - AI Feedback & Recommendations
  - Quick Actions bar
  - Recent Activity feed
  - Gamification stats (optional)
  - Notifications panel toggle
```

#### 14. **Deals Page** `/deals` (Investors) or `/companies` (Founders)
```typescript
Purpose: List view of all deals/companies
Layout: Full app shell with sidebar

Sections:
  - Page header with filters
  - View toggle (Grid | List | Kanban)
  - Status filters (Active, Archived, All)
  - Stage filters (Seed, Series A, etc.)
  - Industry filters
  - Search bar
  - Sort options (Date, Score, Amount, Name)
  - Deal/Company cards
  - Pagination or infinite scroll
  
Actions:
  - Create New Deal button
  - Bulk actions
  - Export to CSV
```

#### 15. **Deal Workspace** `/deals/[id]` (Investors)
```typescript
Purpose: Individual deal analysis workspace
Layout: Full app shell with sidebar

Header:
  - Deal name and logo
  - Status badge
  - Score ring
  - Action buttons (Share, Export, Archive)
  - Role toggle (Investor/Founder view)
  
Tabs:
  1. Overview
     - Deal summary
     - Key metrics grid (15+ scores)
     - Team information
     - Company details
     - Contact information
     
  2. Documents
     - Document library grid
     - Upload button
     - AI-extracted insights
     - Version history
     
  3. Analysis
     - Detailed scoring breakdown
     - Category scores (Team, Financial, Strategic, Risk)
     - Score trends over time
     - Comparison to portfolio average
     
  4. Deep Analysis
     - Perspective selector (Legal, Competitive, Marketing, Strategic)
     - AI-generated reports
     - Findings summary
     - Risk assessment
     - Recommendations
     
  5. Portfolio Analytics
     - Deal fit analysis
     - Portfolio allocation impact
     - Sector diversification
     - Risk contribution
     
Footer:
  - Activity timeline
  - Comment section
  - Collaboration tools
```

#### 16. **Company Workspace** `/companies/[id]` (Founders)
```typescript
Purpose: Company profile and pitch management
Layout: Full app shell with sidebar

Header:
  - Company name and logo
  - Pitch score ring
  - Action buttons (Share, Export, Publish)
  - Role toggle (Founder/Investor view)
  
Tabs:
  1. Overview
     - Company summary
     - Pitch highlights
     - Fundraising status
     - Team information
     - Milestones
     
  2. Documents
     - Pitch deck
     - Financial models
     - Business plan
     - One-pagers
     - Upload/generate options
     
  3. Feedback
     - AI-generated improvements
     - Pitch score breakdown
     - Investor perspective insights
     - Action items
     
  4. Investor Outreach
     - Outreach tracker
     - Investor list
     - Meeting schedule
     - Follow-up reminders
     - Email analytics
     
  5. Fundraising Analytics
     - Progress toward goal
     - Investor pipeline
     - Conversion rates
     - Timeline projections
```

#### 17. **AI Studio** `/studio`
```typescript
Purpose: AI-powered document generation
Layout: Full app shell with sidebar

Sections:
  - Tool selector sidebar
    * Document Generator
    * Content Improver
    * Market Research
    * Pitch Analyzer
    * Financial Modeler
    
  - Main workspace area
    * Input form (context, requirements)
    * AI generation button
    * Output preview
    * Edit tools
    * Export options (PDF, DOCX, PPTX)
    
  - History sidebar
    * Recent generations
    * Saved favorites
    * Templates used
```

#### 18. **Templates** `/templates`
```typescript
Purpose: Browse and use templates
Layout: Full app shell with sidebar

Filters:
  - Category tabs (Investor | Founder | All)
  - Document type (Pitch Deck, Memo, One-Pager, etc.)
  - Industry filter
  - Search bar
  
Template Grid:
  - Template cards with preview
  - Use Template button
  - Preview modal
  - Favorite toggle
  
Template Detail: `/templates/[id]`
  - Full preview
  - Description and use case
  - Customization options
  - Download or open in Studio
```

#### 19. **Analytics** `/analytics`
```typescript
Purpose: Portfolio and performance analytics
Layout: Full app shell with sidebar

Investor View:
  - Portfolio Overview dashboard
  - Performance charts (line, bar, area)
  - Deal pipeline funnel
  - Sector allocation (donut chart)
  - ROI projections
  - Investment timeline
  - Comparative analysis
  - Export reports
  
Founder View:
  - Fundraising progress
  - Investor engagement metrics
  - Pitch performance
  - Outreach analytics
  - Conversion funnel
  - Timeline tracking
  - Export reports
```

#### 20. **ROI Calculator** `/roi-calculator`
```typescript
Purpose: Calculate time and cost savings
Layout: Full app shell with sidebar

Sections:
  - Input form
    * Current process metrics
    * Team size and rates
    * Deal volume
    * Time estimates
    
  - Calculation engine
    * Real-time updates
    * Scenario comparison
    
  - Results display
    * Time savings (hours/year)
    * Cost savings ($/year)
    * ROI percentage
    * Payback period
    * Visualizations
    
  - Export options
    * PDF report
    * Share link
    * Email results
```

#### 21. **Team** `/team`
```typescript
Purpose: Team management and collaboration
Layout: Full app shell with sidebar

Sections:
  - Team members list
    * Member cards (avatar, name, role, stats)
    * Invite button
    * Role badges
    * Online status
    
  - Permissions management
    * Role definitions
    * Access controls
    * Deal sharing settings
    
  - Activity feed
    * Team activity timeline
    * Collaboration metrics
    
  - Leaderboard (if gamification enabled)
    * Rankings by XP
    * Achievements showcase
    * Weekly highlights
```

#### 22. **Settings** `/settings`
```typescript
Purpose: User and app configuration
Layout: Full app shell with sidebar

Setting Sections (Tabs):
  1. Profile Settings
     - Personal information
     - Avatar upload
     - Email preferences
     - Password change
     
  2. Account Settings
     - Plan and billing
     - Usage statistics
     - Subscription management
     - Payment methods
     
  3. Preferences
     - Theme toggle (Light/Dark)
     - Role toggle (Investor/Founder)
     - Language selection
     - Timezone
     - Date format
     
  4. Notifications
     - Email notifications
     - In-app notifications
     - Push notifications (future)
     - Digest frequency
     
  5. Gamification
     - Enable/disable toggle
     - Visibility settings
     - Challenge preferences
     
  6. Integrations (future)
     - Connected apps
     - API keys
     - Webhooks
     
  7. Security
     - Two-factor authentication
     - Active sessions
     - Login history
     - Security logs
     
  8. Data & Privacy
     - Data export
     - Account deletion
     - Privacy settings
```

#### 23. **Profile** `/profile/[userId]`
```typescript
Purpose: Public user profile
Layout: Full app shell with sidebar

Sections:
  - Profile header
    * Avatar
    * Name and title
    * Company/firm
    * Location
    * Social links
    
  - Stats showcase
    * Deals analyzed (investors)
    * Companies founded (founders)
    * XP and level (if gamification)
    * Achievements
    
  - Activity feed
    * Recent deals
    * Shared insights
    * Public achievements
    
  - Portfolio (investors)
    * Public deals
    * Investment focus
    * Expertise areas
```

#### 24. **Notifications** `/notifications`
```typescript
Purpose: Notification center
Layout: Full app shell with sidebar

Sections:
  - Filter tabs (All, Unread, Deals, Team, System)
  - Notification list
    * Card per notification
    * Time stamps
    * Action buttons (View, Dismiss)
    * Mark as read toggle
  - Bulk actions
    * Mark all as read
    * Clear all
  - Settings link
```

#### 25. **Search** `/search`
```typescript
Purpose: Global search results
Layout: Full app shell with sidebar

Sections:
  - Search input with filters
  - Result type tabs (All, Deals, Documents, People, Templates)
  - Results list with highlights
  - Pagination
  - Advanced filters sidebar
```

#### 26. **Help Center** `/help`
```typescript
Purpose: Documentation and support
Layout: Full app shell with sidebar

Sections:
  - Search bar
  - Category navigation
    * Getting Started
    * Features
    * AI Tools
    * Billing
    * Troubleshooting
  - Article grid
  - Video tutorials
  - Contact support CTA
  
Article Page: `/help/[slug]`
  - Article content
  - Table of contents
  - Related articles
  - Was this helpful? feedback
```

---

## Color System & CSS Theme

### 🎨 Complete CSS Variables (Tailwind 4.0 + Custom)

```css
/* /styles/globals.css */

@import "tailwindcss";

/* ============================================
   DESIGN TOKENS - COLOR SYSTEM
   ============================================ */

@theme {
  /* ========================================
     PRIMARY BRAND COLORS
     ======================================== */
  
  --color-primary-50: #eef2ff;      /* Lightest indigo */
  --color-primary-100: #e0e7ff;
  --color-primary-200: #c7d2fe;
  --color-primary-300: #a5b4fc;
  --color-primary-400: #818cf8;
  --color-primary-500: #6366f1;     /* Main brand indigo */
  --color-primary-600: #4f46e5;
  --color-primary-700: #4338ca;
  --color-primary-800: #3730a3;
  --color-primary-900: #312e81;
  --color-primary-950: #1e1b4b;     /* Darkest indigo */

  /* ========================================
     SECONDARY BRAND COLORS (Purple)
     ======================================== */
  
  --color-secondary-50: #faf5ff;
  --color-secondary-100: #f3e8ff;
  --color-secondary-200: #e9d5ff;
  --color-secondary-300: #d8b4fe;
  --color-secondary-400: #c084fc;
  --color-secondary-500: #a855f7;
  --color-secondary-600: #9333ea;
  --color-secondary-700: #7e22ce;
  --color-secondary-800: #6b21a8;
  --color-secondary-900: #581c87;
  --color-secondary-950: #3b0764;

  /* ========================================
     ACCENT GRADIENT (Primary Use)
     ======================================== */
  
  --gradient-primary: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  --gradient-primary-hover: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  --gradient-primary-vertical: linear-gradient(180deg, #6366f1 0%, #8b5cf6 100%);

  /* ========================================
     SEMANTIC COLORS
     ======================================== */

  /* Success (Green) */
  --color-success-50: #f0fdf4;
  --color-success-100: #dcfce7;
  --color-success-200: #bbf7d0;
  --color-success-300: #86efac;
  --color-success-400: #4ade80;
  --color-success-500: #22c55e;
  --color-success-600: #16a34a;
  --color-success-700: #15803d;
  --color-success-800: #166534;
  --color-success-900: #14532d;

  /* Warning (Amber) */
  --color-warning-50: #fffbeb;
  --color-warning-100: #fef3c7;
  --color-warning-200: #fde68a;
  --color-warning-300: #fcd34d;
  --color-warning-400: #fbbf24;
  --color-warning-500: #f59e0b;
  --color-warning-600: #d97706;
  --color-warning-700: #b45309;
  --color-warning-800: #92400e;
  --color-warning-900: #78350f;

  /* Danger/Error (Red) */
  --color-danger-50: #fef2f2;
  --color-danger-100: #fee2e2;
  --color-danger-200: #fecaca;
  --color-danger-300: #fca5a5;
  --color-danger-400: #f87171;
  --color-danger-500: #ef4444;
  --color-danger-600: #dc2626;
  --color-danger-700: #b91c1c;
  --color-danger-800: #991b1b;
  --color-danger-900: #7f1d1d;

  /* Info (Blue) */
  --color-info-50: #eff6ff;
  --color-info-100: #dbeafe;
  --color-info-200: #bfdbfe;
  --color-info-300: #93c5fd;
  --color-info-400: #60a5fa;
  --color-info-500: #3b82f6;
  --color-info-600: #2563eb;
  --color-info-700: #1d4ed8;
  --color-info-800: #1e40af;
  --color-info-900: #1e3a8a;

  /* ========================================
     NEUTRAL COLORS (Grayscale)
     ======================================== */

  --color-gray-50: #f9fafb;
  --color-gray-100: #f3f4f6;
  --color-gray-200: #e5e7eb;
  --color-gray-300: #d1d5db;
  --color-gray-400: #9ca3af;
  --color-gray-500: #6b7280;
  --color-gray-600: #4b5563;
  --color-gray-700: #374151;
  --color-gray-800: #1f2937;
  --color-gray-900: #111827;
  --color-gray-950: #030712;

  /* ========================================
     DARK MODE SPECIFIC COLORS
     ======================================== */

  --color-dark-bg-primary: #0a0a0a;      /* Deepest background */
  --color-dark-bg-secondary: #1a1a1a;    /* Main background */
  --color-dark-bg-tertiary: #2a2a2a;     /* Elevated surfaces */
  --color-dark-bg-elevated: #333333;     /* Cards, modals */

  --color-dark-border: rgba(255, 255, 255, 0.1);
  --color-dark-border-strong: rgba(255, 255, 255, 0.2);

  /* ========================================
     LIGHT MODE SPECIFIC COLORS
     ======================================== */

  --color-light-bg-primary: #ffffff;
  --color-light-bg-secondary: #f9fafb;
  --color-light-bg-tertiary: #f3f4f6;

  --color-light-border: #e5e7eb;
  --color-light-border-strong: #d1d5db;

  /* ========================================
     GLASSMORPHISM EFFECTS
     ======================================== */

  /* Dark Mode Glass */
  --glass-dark-bg: rgba(26, 26, 26, 0.8);
  --glass-dark-border: rgba(255, 255, 255, 0.1);
  --glass-dark-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);

  /* Light Mode Glass */
  --glass-light-bg: rgba(255, 255, 255, 0.8);
  --glass-light-border: rgba(0, 0, 0, 0.1);
  --glass-light-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);

  /* ========================================
     SHADOWS
     ======================================== */

  /* Standard Shadows */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04);
  --shadow-2xl: 0 25px 50px rgba(0, 0, 0, 0.15);

  /* Glow Shadows (for primary elements) */
  --shadow-glow-sm: 0 0 10px rgba(99, 102, 241, 0.3);
  --shadow-glow-md: 0 0 20px rgba(99, 102, 241, 0.4);
  --shadow-glow-lg: 0 0 30px rgba(99, 102, 241, 0.5);
  --shadow-glow-xl: 0 0 50px rgba(99, 102, 241, 0.6);

  /* ========================================
     SPACING SYSTEM (8px base)
     ======================================== */

  --spacing-0: 0px;
  --spacing-1: 4px;      /* 0.5 unit */
  --spacing-2: 8px;      /* 1 unit - BASE */
  --spacing-3: 12px;     /* 1.5 units */
  --spacing-4: 16px;     /* 2 units */
  --spacing-5: 20px;     /* 2.5 units */
  --spacing-6: 24px;     /* 3 units */
  --spacing-8: 32px;     /* 4 units */
  --spacing-10: 40px;    /* 5 units */
  --spacing-12: 48px;    /* 6 units */
  --spacing-16: 64px;    /* 8 units */
  --spacing-20: 80px;    /* 10 units */
  --spacing-24: 96px;    /* 12 units */
  --spacing-32: 128px;   /* 16 units */

  /* ========================================
     BORDER RADIUS
     ======================================== */

  --radius-none: 0px;
  --radius-sm: 4px;
  --radius-md: 8px;      /* Standard cards */
  --radius-lg: 12px;     /* Large cards */
  --radius-xl: 16px;     /* Modals */
  --radius-2xl: 24px;    /* Hero sections */
  --radius-full: 9999px; /* Pills, avatars */

  /* ========================================
     TYPOGRAPHY
     ======================================== */

  /* Font Families */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace;

  /* Font Sizes */
  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.875rem;     /* 14px */
  --text-base: 1rem;       /* 16px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.25rem;      /* 20px */
  --text-2xl: 1.5rem;      /* 24px */
  --text-3xl: 1.875rem;    /* 30px */
  --text-4xl: 2.25rem;     /* 36px */
  --text-5xl: 3rem;        /* 48px */
  --text-6xl: 3.75rem;     /* 60px */

  /* Font Weights */
  --font-light: 300;
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  --font-extrabold: 800;

  /* Line Heights */
  --leading-none: 1;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;

  /* ========================================
     Z-INDEX LAYERS
     ======================================== */

  --z-base: 0;
  --z-dropdown: 1000;
  --z-sticky: 1020;
  --z-fixed: 1030;
  --z-modal-backdrop: 1040;
  --z-modal: 1050;
  --z-popover: 1060;
  --z-tooltip: 1070;
  --z-notification: 1080;
  --z-chat-assistant: 1090;

  /* ========================================
     TRANSITIONS & ANIMATIONS
     ======================================== */

  --transition-fast: 150ms;
  --transition-base: 250ms;
  --transition-slow: 400ms;

  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);

  /* ========================================
     BREAKPOINTS (for reference in JS)
     ======================================== */

  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
  --breakpoint-2xl: 1536px;
}

/* ============================================
   SEMANTIC COLOR CLASSES
   ============================================ */

/* Background Colors */
.bg-primary { background: var(--gradient-primary); }
.bg-success { background-color: var(--color-success-500); }
.bg-warning { background-color: var(--color-warning-500); }
.bg-danger { background-color: var(--color-danger-500); }
.bg-info { background-color: var(--color-info-500); }

/* Text Colors */
.text-primary { color: var(--color-primary-500); }
.text-success { color: var(--color-success-600); }
.text-warning { color: var(--color-warning-600); }
.text-danger { color: var(--color-danger-600); }
.text-info { color: var(--color-info-600); }

/* Border Colors */
.border-primary { border-color: var(--color-primary-500); }
.border-success { border-color: var(--color-success-500); }
.border-warning { border-color: var(--color-warning-500); }
.border-danger { border-color: var(--color-danger-500); }

/* ============================================
   GLASSMORPHISM UTILITY CLASSES
   ============================================ */

.glass-dark {
  background: var(--glass-dark-bg);
  border: 1px solid var(--glass-dark-border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.glass-light {
  background: var(--glass-light-bg);
  border: 1px solid var(--glass-light-border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* ============================================
   GRADIENT UTILITIES
   ============================================ */

.gradient-primary {
  background: var(--gradient-primary);
}

.gradient-primary-text {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.gradient-border {
  position: relative;
  background: var(--gradient-primary);
  padding: 2px;
  border-radius: var(--radius-lg);
}

.gradient-border::before {
  content: '';
  position: absolute;
  inset: 2px;
  background: inherit;
  border-radius: calc(var(--radius-lg) - 2px);
}

/* ============================================
   GLOW EFFECTS
   ============================================ */

.glow-sm {
  box-shadow: var(--shadow-glow-sm);
}

.glow-md {
  box-shadow: var(--shadow-glow-md);
}

.glow-lg {
  box-shadow: var(--shadow-glow-lg);
}

.hover-glow:hover {
  box-shadow: var(--shadow-glow-md);
  transition: box-shadow var(--transition-base) var(--ease-out);
}

/* ============================================
   ANIMATION KEYFRAMES
   ============================================ */

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { 
    opacity: 0;
    transform: translateY(20px);
  }
  to { 
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideDown {
  from { 
    opacity: 0;
    transform: translateY(-20px);
  }
  to { 
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scaleIn {
  from { 
    opacity: 0;
    transform: scale(0.9);
  }
  to { 
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}

/* Animation Utility Classes */
.animate-fade-in { animation: fadeIn var(--transition-base) var(--ease-out); }
.animate-slide-up { animation: slideUp var(--transition-slow) var(--ease-out); }
.animate-slide-down { animation: slideDown var(--transition-slow) var(--ease-out); }
.animate-scale-in { animation: scaleIn var(--transition-base) var(--ease-out); }
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.animate-spin { animation: spin 1s linear infinite; }
.animate-bounce { animation: bounce 1s ease-in-out infinite; }

/* ============================================
   SCROLL BAR STYLING
   ============================================ */

/* Dark Mode Scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--color-dark-bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Light Mode Scrollbar */
.light-mode ::-webkit-scrollbar-track {
  background: var(--color-light-bg-secondary);
}

.light-mode ::-webkit-scrollbar-thumb {
  background: var(--color-gray-300);
}

.light-mode ::-webkit-scrollbar-thumb:hover {
  background: var(--color-gray-400);
}

/* ============================================
   FOCUS STYLES (Accessibility)
   ============================================ */

*:focus-visible {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}

button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* ============================================
   SELECTION STYLING
   ============================================ */

::selection {
  background: var(--color-primary-500);
  color: white;
}

::-moz-selection {
  background: var(--color-primary-500);
  color: white;
}

/* ============================================
   BASE TYPOGRAPHY STYLES
   ============================================ */

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1 { 
  font-size: var(--text-5xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
}

h2 { 
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
}

h3 { 
  font-size: var(--text-3xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
}

h4 { 
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
}

h5 { 
  font-size: var(--text-xl);
  font-weight: var(--font-medium);
  line-height: var(--leading-normal);
}

h6 { 
  font-size: var(--text-lg);
  font-weight: var(--font-medium);
  line-height: var(--leading-normal);
}

p {
  margin-bottom: var(--spacing-4);
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: var(--radius-sm);
}

/* ============================================
   RESPONSIVE UTILITIES
   ============================================ */

@media (max-width: 640px) {
  h1 { font-size: var(--text-4xl); }
  h2 { font-size: var(--text-3xl); }
  h3 { font-size: var(--text-2xl); }
  h4 { font-size: var(--text-xl); }
}
```

---

## Component Hierarchy

### Layout Components
```
AppLayout (Shell)
├── Sidebar Navigation
│   ├── Logo
│   ├── Navigation Links
│   ├── User Profile Menu
│   └── Theme Toggle
├── Top Bar
│   ├── Search
│   ├── Notifications
│   ├── User Avatar
│   └── Quick Actions
├── Main Content Area
│   └── Page Component
└── Chat Assistant (Floating)
```

### Reusable Components
```
UI Components Library
├── Buttons
│   ├── Primary Button
│   ├── Secondary Button
│   ├── Ghost Button
│   └── Icon Button
├── Cards
│   ├── Basic Card
│   ├── Deal Card
│   ├── Stat Card
│   └── Metric Card
├── Forms
│   ├── Input
│   ├── Select
│   ├── Checkbox
│   ├── Radio
│   ├── Toggle
│   └── FileUpload
├── Data Display
│   ├── Table
│   ├── Charts
│   ├── Progress Rings
│   └── Badges
├── Overlays
│   ├── Modal
│   ├── Tooltip
│   ├── Popover
│   └── Toast
└── Feedback
    ├── Loading Spinner
    ├── Skeleton
    └── Empty State
```

---

## Navigation Structure

### Primary Navigation (Sidebar)

**Investor Mode:**
```
🏠 Dashboard
💼 Deals
🎨 AI Studio
📄 Templates
📊 Analytics
🧮 ROI Calculator
👥 Team
⚙️ Settings
```

**Founder Mode:**
```
🏠 Dashboard
🚀 Companies
🎨 AI Studio
📄 Templates
📊 Analytics
🧮 ROI Calculator
👥 Team
⚙️ Settings
```

### Secondary Navigation

**User Menu Dropdown:**
```
👤 Profile
🔔 Notifications
🌓 Dark/Light Mode
🔄 Switch Role (Investor ⇄ Founder)
❓ Help Center
🚪 Logout
```

**Quick Actions:**
```
+ New Deal (Investor) / + New Company (Founder)
📥 Upload Documents
🤖 AI Assistant
📋 Templates
```

---

## Design Tokens Summary

### Color Palette Quick Reference
```
Primary:   #6366f1 → #8b5cf6 (Indigo to Purple Gradient)
Success:   #22c55e (Green)
Warning:   #f59e0b (Amber)
Danger:    #ef4444 (Red)
Info:      #3b82f6 (Blue)

Dark BG:   #0a0a0a, #1a1a1a, #2a2a2a
Light BG:  #ffffff, #f9fafb, #f3f4f6

Grays:     #f9fafb → #030712 (50 to 950)
```

### Spacing Scale
```
Base: 8px
0.5x = 4px
1x = 8px
1.5x = 12px
2x = 16px
3x = 24px
4x = 32px
6x = 48px
8x = 64px
```

### Border Radius
```
sm:  4px   (small elements)
md:  8px   (standard cards)
lg:  12px  (large cards)
xl:  16px  (modals)
2xl: 24px  (hero sections)
```

---

## File Structure

```
/src
├── /pages (or /app for Next.js)
│   ├── index.tsx (Landing)
│   ├── features.tsx
│   ├── pricing.tsx
│   ├── /app
│   │   ├── dashboard.tsx
│   │   ├── deals/
│   │   │   ├── index.tsx
│   │   │   └── [id].tsx
│   │   ├── studio.tsx
│   │   ├── templates.tsx
│   │   ├── analytics.tsx
│   │   ├── team.tsx
│   │   └── settings.tsx
│   └── /legal
│       ├── terms.tsx
│       └── privacy.tsx
├── /components
│   ├── /layout
│   │   ├── AppLayout.tsx
│   │   ├── Sidebar.tsx
│   │   └── TopBar.tsx
│   ├── /ui
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   └── ...
│   ├── /dashboard
│   │   ├── DealCard.tsx
│   │   ├── StatCard.tsx
│   │   └── ...
│   └── /onboarding
│       ├── WelcomeModal.tsx
│       ├── ProfileSetup.tsx
│       └── ...
├── /styles
│   └── globals.css (All CSS variables)
├── /contexts
│   ├── AppSettingsContext.tsx
│   ├── UserRoleContext.tsx
│   └── ThemeContext.tsx
└── /utils
    └── constants.ts
```

---

**Document Version**: 1.0  
**Last Updated**: December 11, 2025  
**Status**: Complete Specification

---

*This specification defines the complete website structure, all pages, navigation, and comprehensive CSS theme system for DealDecision AI.*
