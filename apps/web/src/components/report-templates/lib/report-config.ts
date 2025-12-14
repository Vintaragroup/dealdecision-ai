// Report configuration types and data structures

export interface DealReportData {
  // Basic Info
  dealName: string;
  dealType: 'seed' | 'series-a' | 'series-b' | 'series-c' | 'series-d';
  companyName?: string;
  industry?: string;
  stage?: string;
  fundingAmount?: string;
  valuation?: string;
  date?: string;
  
  // Scores & Ratings
  investorScore: number;
  marketScore: number;
  financialScore: number;
  teamScore: number;
  recommendation: 'strong-yes' | 'yes' | 'maybe' | 'pass';
  
  // Executive Summary
  executiveSummary: {
    overview: string;
    keyHighlights: string[];
    investmentThesis: string;
    keyRisks: string[];
  };
  
  // Market Analysis
  marketAnalysis: {
    tam: string;
    sam?: string;
    som?: string;
    marketGrowthRate: string;
    targetMarketShare: string;
    competitivePosition: string;
    keyCompetitors: Array<{
      name: string;
      strength: string;
      weakness: string;
    }>;
    marketTrends: string[];
    barriers: string[];
  };
  
  // Financial Analysis
  financialAnalysis: {
    currentArr?: string;
    year1Revenue: string;
    year3Revenue: string;
    year5Revenue?: string;
    burnRate: string;
    runway: string;
    breakEvenMonth: string;
    grossMargin?: string;
    ltv?: string;
    cac?: string;
    ltvCacRatio?: string;
    projections: Array<{
      year: string;
      revenue: string;
      expenses: string;
      profit: string;
    }>;
  };
  
  // Team Assessment
  teamAssessment: {
    founderCount: number;
    teamSize: number;
    keyStrengths: string[];
    priorExits?: number;
    advisors?: number;
    keyMembers: Array<{
      name: string;
      role: string;
      background: string;
    }>;
  };
  
  // Competitive Landscape
  competitiveLandscape: {
    ourPosition: string;
    competitiveAdvantages: string[];
    threats: string[];
    competitors: Array<{
      name: string;
      description: string;
      funding: string;
      valuation?: string;
      marketShare?: number;
      strengths: string[];
      weaknesses: string[];
      position?: { x: number; y: number }; // for matrix visualization
    }>;
    marketShareData?: Array<{
      company: string;
      share: number;
    }>;
    featureComparison?: {
      features: string[];
      us: boolean[];
      competitors: Array<{
        name: string;
        hasFeature: boolean[];
      }>;
    };
  };
  
  // ROI Summary
  roiSummary: {
    timeSaved: number;
    moneySaved: number;
    vsLegalFees: string;
    vsConsultantFees: string;
    vsManualHours: string;
    breakdown: Array<{
      category: string;
      saved: string;
    }>;
  };
  
  // Documents
  documents?: {
    total: number;
    completed: number;
    missing: string[];
  };
  
  // Traction
  traction?: {
    customers: number;
    momGrowth: string;
    keyMetrics: Array<{
      label: string;
      value: string;
      trend: string;
    }>;
  };
  
  // Customer/Traction Metrics (detailed)
  tractionMetrics: {
    totalCustomers: number;
    monthlyGrowthRate: number;
    churnRate: number;
    nrr: number;
    avgDealSize: string;
    salesCycle: string;
    topCustomers: string[];
    cohortData: Array<{
      month: string;
      customers: number;
      retention: number;
      revenue: string;
    }>;
    growthTrajectory: Array<{
      month: string;
      customers: number;
      revenue: number;
      mrr: number;
    }>;
    customerSegmentation: Array<{
      segment: string;
      count: number;
      percentage: number;
      avgValue: string;
    }>;
    conversionFunnel: Array<{
      stage: string;
      count: number;
      conversion: number;
    }>;
  };
  
  // Product/Technical Assessment
  productTechnical: {
    productStage: string;
    techStack: {
      frontend: string[];
      backend: string[];
      infrastructure: string[];
      databases: string[];
      other: string[];
    };
    architectureScore: number;
    scalabilityScore: number;
    securityScore: number;
    codeQualityScore: number;
    strengths: string[];
    weaknesses: string[];
    technicalRisks: Array<{
      risk: string;
      severity: 'high' | 'medium' | 'low';
      mitigation: string;
    }>;
    roadmap: Array<{
      quarter: string;
      milestones: string[];
      status: 'completed' | 'in-progress' | 'planned';
    }>;
    patents: {
      filed: number;
      granted: number;
      pending: number;
      description: string;
    };
    developmentMetrics: {
      teamSize: number;
      deploymentFrequency: string;
      averageBugFixTime: string;
      testCoverage: number;
      uptime: number;
    };
  };

  // Risk Map
  riskMap: {
    overallRiskScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    categories: Array<{
      name: string;
      score: number;
      level: 'low' | 'medium' | 'high' | 'critical';
      description: string;
    }>;
    risks: Array<{
      title: string;
      category: string;
      probability: number; // 1-5
      impact: number; // 1-5
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      mitigation: string;
      owner: string;
      status: 'identified' | 'monitoring' | 'mitigating' | 'resolved';
    }>;
    trend: 'improving' | 'stable' | 'worsening';
    lastAssessment: string;
  };

  // Verification Checklist
  verificationChecklist: {
    overallCompletion: number;
    totalItems: number;
    completedItems: number;
    partialItems: number;
    missingItems: number;
    criticalMissing: string[];
    categories: Array<{
      name: string;
      completion: number;
      items: Array<{
        title: string;
        status: 'complete' | 'partial' | 'missing';
        isCritical: boolean;
        description: string;
        lastUpdated?: string;
        notes?: string;
      }>;
    }>;
    lastReview: string;
  };
}

// Generate sample data for testing
export function generateSampleReportData(dealName: string = 'TechVision AI Platform', dealId?: string): DealReportData {
  // Check if this is Vintara deal
  const isVintara = dealId === 'vintara-001' || dealName === 'Vintara Group LLC';
  
  if (isVintara) {
    return {
      dealName: 'Vintara Group LLC',
      dealType: 'series-a',
      companyName: 'Vintara Group LLC',
      industry: 'Beverage Alcohol / CPG',
      stage: 'Series A',
      fundingAmount: '$2M-$3M',
      valuation: '$15M pre-money',
      date: 'September 5, 2025',
      
      investorScore: 86,
      marketScore: 90,
      financialScore: 88,
      teamScore: 82,
      recommendation: 'strong-yes',
      
      executiveSummary: {
        overview: 'Vintara Group is a spirits brand accelerator acquiring and scaling premium brands in high-growth categories. Lead asset is Califino Tequila, a celebrity-backed brand with strong DTC momentum and strategic distribution partnerships. The holding company model enables rapid portfolio expansion while maintaining lean operations.',
        keyHighlights: [
          'Califino Tequila brand acquisition closing Q3 2025 with celebrity endorsement',
          'Tequila category growing +40% YoY with premiumization trend',
          'Proven operator: Founder scaled prior brand to 8-state distribution',
          'Asset-light HoldCo model enables 2-3 brand acquisitions per year',
          'Clear path to $3M+ TTM revenue within 18 months',
          'Strategic partnerships with major distributors (Southern Glazer\'s, RNDC)'
        ],
        investmentThesis: 'Vintara Group addresses a compelling opportunity in spirits brand consolidation. The beverage alcohol market is fragmented with thousands of small brands lacking capital and distribution expertise. Vintara\'s operator-first approach, combined with proven distribution relationships and celebrity partnerships, creates a scalable model for brand acquisition and growth. The tequila category tailwind (+40% YoY) and DTC capabilities provide strong near-term revenue potential.',
        keyRisks: [
          'Regulatory complexity across state-by-state distribution (3-tier system)',
          'Reliance on single lead brand (Califino) in early portfolio',
          'Working capital intensive (inventory, production)',
          'Category competition from established players (Diageo, Pernod Ricard)'
        ]
      },
      
      marketAnalysis: {
        tam: '$84B',
        sam: '$12B',
        som: '$450M',
        marketGrowthRate: '+40% YoY (Tequila)',
        targetMarketShare: '0.3% of premium tequila by Y3',
        competitivePosition: 'Differentiated consolidator in fragmented market',
        keyCompetitors: [
          {
            name: 'Constellation Brands',
            strength: 'Category leader, massive distribution',
            weakness: 'Focus on mass market, slow to innovate'
          },
          {
            name: 'Diageo / Pernod Ricard',
            strength: 'Global spirits conglomerates',
            weakness: 'Bureaucratic, overlook small premium brands'
          },
          {
            name: 'Independent Brand Operators',
            strength: 'Entrepreneurial, category passion',
            weakness: 'Undercapitalized, lack distribution expertise'
          }
        ],
        marketTrends: [
          'Premiumization: Consumers trading up to higher-quality spirits',
          'Tequila explosion: +40% YoY growth driven by cocktail culture',
          'DTC channel growth: E-commerce becoming viable for alcohol',
          'Celebrity/influencer brands gaining market share',
          'Sustainability and craft positioning resonating with consumers'
        ],
        barriers: [
          'Three-tier distribution system creates regulatory moat',
          'Established distributor relationships difficult to replicate',
          'Brand equity and consumer loyalty take years to build',
          'Working capital requirements limit new entrants'
        ]
      },
      
      financialAnalysis: {
        currentArr: '$0 (pre-revenue)',
        year1Revenue: '$850K',
        year3Revenue: '$3.2M',
        year5Revenue: '$8M+',
        burnRate: '$65K/mo',
        runway: '24 months (post-raise)',
        breakEvenMonth: 'Q3 2026 (HoldCo)',
        grossMargin: '42%',
        ltv: 'TBD',
        cac: 'TBD',
        ltvCacRatio: 'TBD',
        projections: [
          { year: 'Q3 2025', revenue: '$125K', expenses: '$195K', profit: '-$70K' },
          { year: 'Q4 2025', revenue: '$275K', expenses: '$215K', profit: '$60K' },
          { year: 'Q1 2026', revenue: '$385K', expenses: '$235K', profit: '$150K' },
          { year: 'Q2 2026', revenue: '$485K', expenses: '$245K', profit: '$240K' },
          { year: 'Q3 2026', revenue: '$625K', expenses: '$255K', profit: '$370K' }
        ]
      },
      
      teamAssessment: {
        founderCount: 1,
        teamSize: 5,
        keyStrengths: [
          'Founder scaled previous spirits brand to 8-state distribution',
          'Deep distributor relationships (Southern Glazer\'s, RNDC)',
          'CPG operating experience with P&L ownership',
          'Strong celebrity/influencer network for brand partnerships'
        ],
        priorExits: 0,
        advisors: 2,
        keyMembers: [
          {
            name: 'Founder/CEO',
            role: 'Chief Executive Officer',
            background: 'Former brand manager, scaled spirits brand to $5M+ revenue, 10+ years beverage industry'
          },
          {
            name: 'VP Sales & Distribution',
            role: 'Sales Lead',
            background: 'Ex-Southern Glazer\'s, deep distributor relationships across priority markets'
          },
          {
            name: 'Marketing Director',
            role: 'Brand & Digital Marketing',
            background: 'DTC and influencer marketing expert, launched 3 CPG brands'
          }
        ]
      },
      
      competitiveLandscape: {
        ourPosition: 'Differentiated brand consolidator with operator expertise and distribution relationships in high-growth premium spirits category',
        competitiveAdvantages: [
          'Operator-first approach vs. financial buyer model',
          'Proven distributor relationships accelerate go-to-market',
          'Asset-light HoldCo structure enables rapid portfolio expansion',
          'Category expertise in high-growth tequila/mezcal segment',
          'Celebrity partnership model for brand awareness'
        ],
        threats: [
          'Large spirits conglomerates (Diageo, Constellation) acquiring premium brands',
          'Regulatory changes to 3-tier distribution system',
          'Economic downturn impacting premium spirits consumption',
          'Oversaturation in tequila category as growth attracts competition',
          'Distribution consolidation reducing negotiating leverage'
        ],
        competitors: [
          {
            name: 'Sovereign Brands',
            description: 'Independent spirits brand builder (Luc Belaire, Bumbu)',
            funding: 'Bootstrapped',
            valuation: 'N/A',
            marketShare: 2,
            strengths: [
              'Massive celebrity endorsements (50 Cent, DJ Khaled)',
              'Strong nightlife/on-premise presence',
              'Proven brand building playbook'
            ],
            weaknesses: [
              'Limited portfolio diversification (focused on few brands)',
              'Heavy reliance on celebrity partnerships',
              'Not actively acquiring external brands'
            ]
          },
          {
            name: 'Catoctin Creek',
            description: 'Craft distillery with distribution partnerships',
            funding: '$5M',
            valuation: '$25M',
            marketShare: 1,
            strengths: [
              'Own distillery provides production control',
              'Award-winning products with strong reviews',
              'Growing regional distribution'
            ],
            weaknesses: [
              'Production-heavy model limits scalability',
              'Single-brand focus (whiskey)',
              'Regional distribution only (not national)'
            ]
          },
          {
            name: 'Constellation Brands',
            description: 'Public spirits conglomerate ($45B market cap)',
            funding: 'Public',
            valuation: '$45B',
            marketShare: 18,
            strengths: [
              'Massive distribution infrastructure',
              'Deep pockets for acquisitions and marketing',
              'Portfolio of established brands (Corona, Modelo)'
            ],
            weaknesses: [
              'Focus on mass-market, not premium craft',
              'Bureaucratic decision-making',
              'Overlook small emerging brands'
            ]
          }
        ],
        marketShareData: [
          { company: 'Constellation', share: 18 },
          { company: 'Diageo', share: 15 },
          { company: 'Pernod Ricard', share: 12 },
          { company: 'Beam Suntory', share: 10 },
          { company: 'Others/Independent', share: 45 }
        ],
        featureComparison: {
          features: [
            'Multi-Brand Portfolio',
            'National Distribution',
            'Celebrity Partnerships',
            'DTC Capabilities',
            'Production Ownership',
            'Operator Expertise',
            'Active Acquisition Strategy',
            'Asset-Light Model'
          ],
          us: [true, true, true, true, false, true, true, true],
          competitors: [
            { name: 'Sovereign Brands', hasFeature: [true, true, true, false, false, true, false, false] },
            { name: 'Catoctin Creek', hasFeature: [false, false, false, true, true, true, false, false] },
            { name: 'Constellation', hasFeature: [true, true, false, false, true, false, true, false] }
          ]
        }
      },
      
      roiSummary: {
        timeSaved: 75,
        moneySaved: 16500,
        vsLegalFees: '$4K-$12K',
        vsConsultantFees: '$6K-$20K',
        vsManualHours: '50-100 hours',
        breakdown: [
          { category: 'Legal due diligence & document review', saved: '$4K-$12K' },
          { category: 'Market research & category analysis', saved: '$6K-$20K' },
          { category: 'Financial modeling & projections', saved: '30-50 hours' },
          { category: 'Competitive landscape mapping', saved: '20-30 hours' },
          { category: 'Regulatory compliance review', saved: '$3K-$7K' },
          { category: 'Distribution strategy analysis', saved: '15-20 hours' }
        ]
      },
      
      documents: {
        total: 8,
        completed: 7,
        missing: ['Califino Brand Purchase Agreement']
      },
      
      traction: {
        customers: 0,
        momGrowth: 'Pre-launch',
        keyMetrics: [
          { label: 'Lead Brand Status', value: 'Califino', trend: 'Closing Q3 2025' },
          { label: 'Distribution Partners', value: '2 major', trend: 'Southern Glazer\'s, RNDC' },
          { label: 'Target Launch States', value: '3-5', trend: 'TX, FL, CO, AZ, GA' },
        ],
        customerList: []
      },
      
      productTechnical: {
        productStage: 'Pre-launch / Brand Acquisition',
        techStack: {
          frontend: ['Shopify', 'ReserveBar Integration'],
          backend: ['DTC E-commerce Platform'],
          infrastructure: ['Distribution Network', 'Inventory Management'],
          databases: [],
          other: ['Celebrity Partnership Platform', 'Social Media Marketing']
        },
        architectureScore: 75,
        scalabilityScore: 85,
        securityScore: 80,
        codeQualityScore: 70,
        strengths: [
          'Asset-light HoldCo model highly scalable',
          'Proven distributor relationships (Southern Glazer\'s, RNDC)',
          'DTC e-commerce capabilities for direct consumer reach',
          'Celebrity partnership playbook for brand awareness'
        ],
        weaknesses: [
          'Limited tech infrastructure (not a tech company)',
          'Heavy reliance on third-party distributors',
          'Multi-state regulatory complexity',
          'Working capital intensive for inventory'
        ],
        technicalRisks: [
          {
            risk: 'Multi-state regulatory compliance (TTB, ABC boards)',
            severity: 'high',
            mitigation: 'Partner with experienced distributors and compliance consultants'
          },
          {
            risk: 'Inventory management and working capital optimization',
            severity: 'medium',
            mitigation: 'Negotiate favorable payment terms with suppliers/distributors'
          },
          {
            risk: 'Scaling operations while maintaining quality',
            severity: 'medium',
            mitigation: 'Hire experienced operators and implement SOPs early'
          }
        ],
        roadmap: [
          {
            quarter: 'Q3 2025',
            milestones: ['Close Califino acquisition', 'Secure celebrity endorsement', 'Finalize distributor agreements'],
            status: 'in-progress'
          },
          {
            quarter: 'Q4 2025',
            milestones: ['Launch in 3-5 priority states', 'Build DTC e-commerce presence', 'Execute launch marketing campaign'],
            status: 'planned'
          },
          {
            quarter: 'Q1 2026',
            milestones: ['Acquire 2nd brand (agave category)', 'Expand to 8-10 states', 'Scale DTC revenue to $100K/mo'],
            status: 'planned'
          },
          {
            quarter: 'Q2-Q4 2026',
            milestones: ['Expand to 15+ states', 'Portfolio: 3-4 brands', 'Achieve $3M+ TTM revenue'],
            status: 'planned'
          }
        ],
        patents: {
          filed: 0,
          granted: 0,
          pending: 0,
          description: 'N/A - Brand acquisition business model, not tech IP'
        },
        developmentMetrics: {
          teamSize: 5,
          deploymentFrequency: 'N/A',
          averageBugFixTime: 'N/A',
          testCoverage: 0,
          uptime: 0
        }
      },
      
      riskMap: {
        overallRiskScore: 72,
        riskLevel: 'medium',
        categories: [
          {
            name: 'Regulatory Risk',
            score: 85,
            level: 'high',
            description: 'Three-tier system complexity and state-by-state compliance requirements'
          },
          {
            name: 'Concentration Risk',
            score: 80,
            level: 'high',
            description: 'Heavy reliance on Califino as lead brand in early portfolio'
          },
          {
            name: 'Working Capital Risk',
            score: 70,
            level: 'medium',
            description: 'Inventory-intensive business requires significant cash management'
          },
          {
            name: 'Market Competition Risk',
            score: 65,
            level: 'medium',
            description: 'Tequila category attracting increased competition from established players'
          },
          {
            name: 'Economic Risk',
            score: 50,
            level: 'low',
            description: 'Premium spirits sales could decline in economic downturn'
          }
        ],
        risks: [
          {
            title: 'Three-Tier Distribution Compliance',
            category: 'Regulatory Risk',
            probability: 3,
            impact: 5,
            severity: 'high',
            description: 'State-by-state alcohol regulations and TTB compliance requirements create complexity',
            mitigation: 'Partner with experienced distributors who handle compliance in each state',
            owner: 'Legal/Compliance',
            status: 'monitoring'
          },
          {
            title: 'Single Brand Concentration',
            category: 'Concentration Risk',
            probability: 5,
            impact: 4,
            severity: 'high',
            description: 'Heavy reliance on Califino brand performance in early stages',
            mitigation: 'Accelerate 2nd brand acquisition timeline to Q1 2026',
            owner: 'CEO',
            status: 'mitigating'
          },
          {
            title: 'Working Capital Management',
            category: 'Working Capital Risk',
            probability: 4,
            impact: 3,
            severity: 'medium',
            description: 'Inventory purchases and production require significant upfront capital',
            mitigation: 'Negotiate favorable payment terms with suppliers and distributors',
            owner: 'CFO',
            status: 'monitoring'
          },
          {
            title: 'Category Oversaturation',
            category: 'Market Competition Risk',
            probability: 3,
            impact: 3,
            severity: 'medium',
            description: 'Tequila category growth attracting new entrants from large conglomerates',
            mitigation: 'Focus on premium positioning and celebrity partnerships for differentiation',
            owner: 'Marketing',
            status: 'identified'
          },
          {
            title: 'Economic Downturn Impact',
            category: 'Economic Risk',
            probability: 2,
            impact: 3,
            severity: 'low',
            description: 'Premium spirits consumption could decline in recession',
            mitigation: 'Maintain operational efficiency and portfolio diversification',
            owner: 'CEO',
            status: 'identified'
          },
          {
            title: 'Califino Acquisition Closing Risk',
            category: 'Concentration Risk',
            probability: 2,
            impact: 5,
            severity: 'high',
            description: 'Brand acquisition may not close as planned',
            mitigation: 'Have backup brand targets identified and negotiate favorable deal terms',
            owner: 'CEO',
            status: 'monitoring'
          }
        ],
        trend: 'stable',
        lastAssessment: '2025-09-05'
      },
      
      tractionMetrics: {
        totalCustomers: 0,
        monthlyGrowthRate: 0,
        churnRate: 0,
        nrr: 0,
        avgDealSize: '$45-65',
        salesCycle: 'N/A (B2C)',
        topCustomers: ['Pre-launch'],
        cohortData: [
          { month: 'Oct 2025 (Proj)', customers: 250, retention: 100, revenue: '$12.5K' },
          { month: 'Nov 2025 (Proj)', customers: 425, retention: 98, revenue: '$22K' },
          { month: 'Dec 2025 (Proj)', customers: 650, retention: 96, revenue: '$35K' },
          { month: 'Jan 2026 (Proj)', customers: 900, retention: 95, revenue: '$48K' },
          { month: 'Feb 2026 (Proj)', customers: 1200, retention: 94, revenue: '$62K' },
          { month: 'Mar 2026 (Proj)', customers: 1550, retention: 93, revenue: '$78K' }
        ],
        growthTrajectory: [
          { month: 'Q3 2025 (Launch)', customers: 0, revenue: 0, mrr: 0 },
          { month: 'Oct 2025', customers: 250, revenue: 12500, mrr: 12500 },
          { month: 'Nov 2025', customers: 425, revenue: 22000, mrr: 22000 },
          { month: 'Dec 2025', customers: 650, revenue: 35000, mrr: 35000 },
          { month: 'Jan 2026', customers: 900, revenue: 48000, mrr: 48000 },
          { month: 'Feb 2026', customers: 1200, revenue: 62000, mrr: 62000 },
          { month: 'Mar 2026', customers: 1550, revenue: 78000, mrr: 78000 },
          { month: 'Apr 2026', customers: 1950, revenue: 95000, mrr: 95000 },
          { month: 'May 2026', customers: 2400, revenue: 115000, mrr: 115000 },
          { month: 'Jun 2026', customers: 2900, revenue: 138000, mrr: 138000 }
        ],
        customerSegmentation: [
          { segment: 'Premium Tequila Consumers', count: 0, percentage: 60, avgValue: '$55' },
          { segment: 'Gift/Special Occasion', count: 0, percentage: 25, avgValue: '$65' },
          { segment: 'Restaurant/Bar On-Premise', count: 0, percentage: 15, avgValue: '$45' }
        ],
        conversionFunnel: [
          { stage: 'Website Visitors (Projected)', count: 50000, conversion: 100 },
          { stage: 'Product Page Views', count: 8000, conversion: 16 },
          { stage: 'Add to Cart', count: 2400, conversion: 4.8 },
          { stage: 'Checkout Started', count: 1200, conversion: 2.4 },
          { stage: 'Purchase Completed', count: 650, conversion: 1.3 }
        ]
      },
      
      verificationChecklist: {
        overallCompletion: 85,
        totalItems: 20,
        completedItems: 17,
        partialItems: 2,
        missingItems: 1,
        criticalMissing: ['IP Assignment Agreements'],
        categories: [
          {
            name: 'Legal Documents',
            completion: 90,
            items: [
              { title: 'Term Sheet', status: 'complete', isCritical: true, description: 'Agreement outlining key terms and conditions of the investment.' },
              { title: 'Investor Rights Agreement', status: 'complete', isCritical: true, description: 'Agreement detailing the rights and obligations of the investor.' },
              { title: 'Shareholder Agreement', status: 'complete', isCritical: true, description: 'Agreement governing the rights and responsibilities of shareholders.' },
              { title: 'IP Assignment Agreements', status: 'missing', isCritical: true, description: 'Agreements transferring intellectual property rights to the company.' }
            ]
          },
          {
            name: 'Financial Documents',
            completion: 80,
            items: [
              { title: 'Financial Projections', status: 'complete', isCritical: true, description: 'Projected financial statements for the next 5 years.' },
              { title: 'Audit Reports', status: 'partial', isCritical: true, description: 'Recent audit reports for the company.' },
              { title: 'Tax Returns', status: 'complete', isCritical: true, description: 'Recent tax returns for the company.' }
            ]
          },
          {
            name: 'Operational Documents',
            completion: 95,
            items: [
              { title: 'Business Plan', status: 'complete', isCritical: true, description: 'Detailed business plan outlining the company\'s strategy and goals.' },
              { title: 'Marketing Plan', status: 'complete', isCritical: true, description: 'Marketing strategy and plan for the company.' },
              { title: 'Sales Plan', status: 'complete', isCritical: true, description: 'Sales strategy and plan for the company.' },
              { title: 'Operational Plan', status: 'complete', isCritical: true, description: 'Operational strategy and plan for the company.' }
            ]
          }
        ],
        lastReview: '2025-09-05'
      }
    };
  }
  
  // Default TechVision AI data
  return {
    dealName,
    dealType: 'series-a',
    companyName: dealName,
    industry: 'Enterprise AI/SaaS',
    stage: 'Series A',
    fundingAmount: '$5M',
    valuation: '$25M',
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    
    investorScore: 87,
    marketScore: 95,
    financialScore: 88,
    teamScore: 82,
    recommendation: 'strong-yes',
    
    executiveSummary: {
      overview: 'TechVision AI is building the next generation of enterprise AI infrastructure, enabling companies to deploy custom AI models at scale. With proven founders (2 prior exits) and a team from Google, Meta, and OpenAI, they are uniquely positioned to capture a significant portion of the $2.5B market opportunity.',
      keyHighlights: [
        'Strong product-market fit with 15 enterprise customers paying $850K ARR',
        'Exceptional 40% month-over-month growth trajectory',
        'World-class technical team with deep AI/ML expertise',
        'Clear competitive moat through proprietary technology',
        'Impressive unit economics with 75% gross margins',
        '18-month runway with path to profitability'
      ],
      investmentThesis: 'TechVision AI addresses a critical pain point in the enterprise AI market - the complexity of deploying and scaling custom models. Their platform reduces deployment time from months to days, with a proven ROI of 10x for customers. The combination of exceptional founder pedigree, strong early traction, and favorable market dynamics makes this a compelling Series A opportunity.',
      keyRisks: [
        'Competitive landscape intensifying with well-funded players',
        'Customer concentration risk (top 3 customers = 60% of revenue)',
        'Technical complexity may slow enterprise sales cycles',
        'Need to expand team rapidly to maintain growth trajectory'
      ]
    },
    
    marketAnalysis: {
      tam: '$2.5B',
      sam: '$800M',
      som: '$125M',
      marketGrowthRate: '24% YoY',
      targetMarketShare: '5% by Y3',
      competitivePosition: 'Strong differentiator',
      keyCompetitors: [
        {
          name: 'DataRobot',
          strength: 'Market leader, strong brand',
          weakness: 'Limited customization, high price point'
        },
        {
          name: 'H2O.ai',
          strength: 'Open source community',
          weakness: 'Weak enterprise features'
        },
        {
          name: 'AWS SageMaker',
          strength: 'AWS ecosystem integration',
          weakness: 'Complex to use, vendor lock-in concerns'
        }
      ],
      marketTrends: [
        'Rapid enterprise AI adoption across all industries',
        'Shift from generic ML to domain-specific AI solutions',
        'Increasing demand for AI governance and compliance',
        'Move toward hybrid/multi-cloud deployments',
        'Growing importance of explainable AI'
      ],
      barriers: [
        'Proprietary model optimization algorithms',
        'Strategic partnerships with major cloud providers',
        'Strong customer success creating switching costs',
        'Network effects from model marketplace'
      ]
    },
    
    financialAnalysis: {
      currentArr: '$850K',
      year1Revenue: '$1.2M',
      year3Revenue: '$8.5M',
      year5Revenue: '$28M',
      burnRate: '$125K/mo',
      runway: '18 months',
      breakEvenMonth: 'Month 18',
      grossMargin: '75%',
      ltv: '$285K',
      cac: '$28K',
      ltvCacRatio: '10.2x',
      projections: [
        { year: 'Y1', revenue: '$1.2M', expenses: '$2.8M', profit: '-$1.6M' },
        { year: 'Y2', revenue: '$3.8M', expenses: '$4.2M', profit: '-$400K' },
        { year: 'Y3', revenue: '$8.5M', expenses: '$7.8M', profit: '$700K' },
        { year: 'Y4', revenue: '$16M', expenses: '$12M', profit: '$4M' },
        { year: 'Y5', revenue: '$28M', expenses: '$18M', profit: '$10M' }
      ]
    },
    
    teamAssessment: {
      founderCount: 3,
      teamSize: 12,
      keyStrengths: [
        'Founders have 2 prior successful exits ($45M and $120M)',
        'Technical team from Google Brain, Meta AI, and OpenAI',
        'Strong domain expertise in enterprise AI deployment',
        'Complementary skill sets: CEO (sales), CTO (tech), CPO (product)'
      ],
      priorExits: 2,
      advisors: 3,
      keyMembers: [
        {
          name: 'Sarah Chen',
          role: 'CEO & Co-Founder',
          background: 'Former VP Sales at DataRobot, 2 prior exits, Stanford MBA'
        },
        {
          name: 'Dr. Michael Rodriguez',
          role: 'CTO & Co-Founder',
          background: 'Ex-Google Brain, PhD in ML from MIT, 15 years AI research'
        },
        {
          name: 'Jessica Wong',
          role: 'CPO & Co-Founder',
          background: 'Former Product Lead at Meta AI, Carnegie Mellon CS'
        }
      ]
    },
    
    competitiveLandscape: {
      ourPosition: 'Well-positioned as a differentiated challenger with strong technical moat and early traction in enterprise AI deployment space',
      competitiveAdvantages: [
        'Proprietary model optimization technology reduces deployment time by 90%',
        'Deep enterprise relationships with Fortune 500 companies',
        'Superior customer success with 135% net revenue retention',
        'Unique hybrid/multi-cloud architecture provides vendor flexibility',
        'Strong network effects from growing model marketplace'
      ],
      threats: [
        'AWS, Google Cloud, and Azure expanding their managed AI offerings',
        'Well-funded competitors (DataRobot $1B+, H2O.ai $250M) moving into our space',
        'Risk of consolidation in enterprise AI market',
        'Potential commoditization of AI deployment infrastructure',
        'New AI regulations could create compliance burden'
      ],
      competitors: [
        {
          name: 'DataRobot',
          description: 'Market leader in enterprise AutoML and AI platforms',
          funding: '$1B+',
          valuation: '$6.3B',
          marketShare: 28,
          strengths: [
            'Strong brand recognition and market presence',
            'Comprehensive platform with broad feature set',
            'Large customer base (600+ enterprises)'
          ],
          weaknesses: [
            'High price point limits SMB adoption',
            'Complex UI with steep learning curve',
            'Limited customization for unique use cases'
          ]
        },
        {
          name: 'H2O.ai',
          description: 'Open-source focused AI platform provider',
          funding: '$250M',
          valuation: '$1.6B',
          marketShare: 15,
          strengths: [
            'Strong open-source community (20K+ developers)',
            'Free tier drives top-of-funnel adoption',
            'Good technical documentation'
          ],
          weaknesses: [
            'Weaker enterprise features and support',
            'Monetization challenges from freemium model',
            'Limited sales/marketing compared to competitors'
          ]
        },
        {
          name: 'AWS SageMaker',
          description: 'Amazon Web Services managed ML platform',
          funding: 'N/A (AWS)',
          valuation: 'N/A',
          marketShare: 22,
          strengths: [
            'Deep AWS ecosystem integration',
            'Massive scale and infrastructure',
            'Competitive pricing for AWS customers'
          ],
          weaknesses: [
            'Vendor lock-in concerns for multi-cloud customers',
            'Complex setup and configuration',
            'Limited support for non-AWS infrastructure'
          ]
        }
      ],
      marketShareData: [
        { company: 'DataRobot', share: 28 },
        { company: 'AWS SageMaker', share: 22 },
        { company: 'H2O.ai', share: 15 },
        { company: 'TechVision AI', share: 8 },
        { company: 'Others', share: 27 }
      ],
      featureComparison: {
        features: [
          'Custom Model Deployment',
          'Multi-Cloud Support',
          'AutoML Capabilities',
          'Real-time Inference',
          'Model Marketplace',
          'Enterprise Security (SOC2)',
          'White-Label Options',
          'API-First Architecture'
        ],
        us: [true, true, true, true, true, true, true, true],
        competitors: [
          { name: 'DataRobot', hasFeature: [true, false, true, true, false, true, false, true] },
          { name: 'H2O.ai', hasFeature: [true, true, true, true, false, false, false, true] },
          { name: 'SageMaker', hasFeature: [true, false, true, true, false, true, false, true] }
        ]
      }
    },
    
    roiSummary: {
      timeSaved: 85,
      moneySaved: 18500,
      vsLegalFees: '$5K-$15K',
      vsConsultantFees: '$8K-$25K',
      vsManualHours: '60-120 hours',
      breakdown: [
        { category: 'Document drafting & legal review', saved: '$5K-$15K' },
        { category: 'Due diligence analysis', saved: '$8K-$25K' },
        { category: 'Market research & analysis', saved: '40-60 hours' },
        { category: 'Risk assessment & modeling', saved: '20-40 hours' },
        { category: 'Financial model review', saved: '$3K-$8K' },
        { category: 'Competitive intelligence gathering', saved: '15-25 hours' }
      ]
    },
    
    documents: {
      total: 8,
      completed: 7,
      missing: ['IP Assignment Agreements']
    },
    
    traction: {
      customers: 15,
      momGrowth: '40%',
      keyMetrics: [
        { label: 'ARR', value: '$850K', trend: '+145% YoY' },
        { label: 'Enterprise Customers', value: '15', trend: '+8 this month' },
        { label: 'Net Revenue Retention', value: '135%', trend: 'Strong' },
        { label: 'Average Deal Size', value: '$65K', trend: '+22%' }
      ]
    },
    
    tractionMetrics: {
      totalCustomers: 15,
      monthlyGrowthRate: 40,
      churnRate: 2.5,
      nrr: 135,
      avgDealSize: '$65K',
      salesCycle: '45 days',
      topCustomers: [
        'Acme Corp',
        'TechGiant Inc',
        'Global Systems',
        'Enterprise Solutions Ltd',
        'Future Labs'
      ],
      cohortData: [
        { month: 'Jan 2024', customers: 3, retention: 100, revenue: '$15K' },
        { month: 'Feb 2024', customers: 5, retention: 100, revenue: '$28K' },
        { month: 'Mar 2024', customers: 7, retention: 95, revenue: '$42K' },
        { month: 'Apr 2024', customers: 9, retention: 92, revenue: '$58K' },
        { month: 'May 2024', customers: 11, retention: 90, revenue: '$71K' },
        { month: 'Jun 2024', customers: 12, retention: 88, revenue: '$78K' },
        { month: 'Jul 2024', customers: 13, retention: 87, revenue: '$85K' },
        { month: 'Aug 2024', customers: 14, retention: 85, revenue: '$91K' }
      ],
      growthTrajectory: [
        { month: 'Jan 2024', customers: 3, revenue: 15000, mrr: 15000 },
        { month: 'Feb 2024', customers: 5, revenue: 28000, mrr: 28000 },
        { month: 'Mar 2024', customers: 7, revenue: 42000, mrr: 42000 },
        { month: 'Apr 2024', customers: 9, revenue: 58000, mrr: 58000 },
        { month: 'May 2024', customers: 11, revenue: 71000, mrr: 71000 },
        { month: 'Jun 2024', customers: 12, revenue: 78000, mrr: 78000 },
        { month: 'Jul 2024', customers: 13, revenue: 85000, mrr: 85000 },
        { month: 'Aug 2024', customers: 14, revenue: 91000, mrr: 91000 },
        { month: 'Sep 2024', customers: 15, revenue: 98000, mrr: 98000 },
        { month: 'Oct 2024', customers: 17, revenue: 110000, mrr: 110000 },
        { month: 'Nov 2024', customers: 19, revenue: 125000, mrr: 125000 }
      ],
      customerSegmentation: [
        { segment: 'Enterprise Technology', count: 6, percentage: 40, avgValue: '$75K' },
        { segment: 'Financial Services', count: 4, percentage: 26.7, avgValue: '$85K' },
        { segment: 'Healthcare', count: 2, percentage: 13.3, avgValue: '$60K' },
        { segment: 'Manufacturing', count: 2, percentage: 13.3, avgValue: '$55K' },
        { segment: 'Retail & E-commerce', count: 1, percentage: 6.7, avgValue: '$45K' }
      ],
      conversionFunnel: [
        { stage: 'Leads Generated', count: 500, conversion: 100 },
        { stage: 'Qualified Leads', count: 150, conversion: 30 },
        { stage: 'Demos Scheduled', count: 75, conversion: 15 },
        { stage: 'Proposals Sent', count: 40, conversion: 8 },
        { stage: 'Negotiations', count: 25, conversion: 5 },
        { stage: 'Closed Won', count: 15, conversion: 3 }
      ]
    },
    
    productTechnical: {
      productStage: 'Production (v2.3)',
      techStack: {
        frontend: ['React 18', 'TypeScript', 'Next.js', 'Tailwind CSS'],
        backend: ['Node.js', 'Python', 'FastAPI', 'GraphQL'],
        infrastructure: ['AWS (primary)', 'GCP (secondary)', 'Docker', 'Kubernetes'],
        databases: ['PostgreSQL', 'Redis', 'MongoDB', 'Elasticsearch'],
        other: ['Jenkins CI/CD', 'Terraform', 'DataDog', 'Sentry']
      },
      architectureScore: 92,
      scalabilityScore: 88,
      securityScore: 91,
      codeQualityScore: 94,
      strengths: [
        'Modern microservices architecture with API-first design',
        'Multi-cloud infrastructure reduces vendor lock-in risk',
        '99.9% uptime with robust monitoring and alerting',
        'Automated testing with 90% code coverage',
        'SOC 2 Type II compliant security practices',
        'Scalable to 10x current load without architecture changes'
      ],
      weaknesses: [
        'Technical debt in legacy authentication module (planned refactor Q3)',
        'Documentation could be more comprehensive for new developers',
        'Some frontend components need accessibility improvements',
        'Monorepo structure increases CI/CD build times'
      ],
      technicalRisks: [
        {
          risk: 'Legacy authentication module security vulnerabilities',
          severity: 'high',
          mitigation: 'Complete rewrite scheduled for Q3 2024 with OAuth 2.0 and SSO support'
        },
        {
          risk: 'Database scaling limitations at 100K+ concurrent users',
          severity: 'medium',
          mitigation: 'Implementing read replicas and caching layer in Q2 2024'
        },
        {
          risk: 'Third-party API dependencies (OpenAI, AWS)',
          severity: 'medium',
          mitigation: 'Building fallback systems and rate limiting with graceful degradation'
        },
        {
          risk: 'Talent retention for specialized AI/ML engineers',
          severity: 'low',
          mitigation: 'Competitive compensation, equity, and professional development programs'
        }
      ],
      roadmap: [
        {
          quarter: 'Q1 2024',
          milestones: [
            'Launch v2.0 with multi-cloud support',
            'Achieve SOC 2 Type II certification',
            'Scale to 10K concurrent users'
          ],
          status: 'completed'
        },
        {
          quarter: 'Q2 2024',
          milestones: [
            'Implement advanced caching layer',
            'Launch API v3 with GraphQL',
            'Expand to 3 AWS regions'
          ],
          status: 'in-progress'
        },
        {
          quarter: 'Q3 2024',
          milestones: [
            'Rebuild authentication system',
            'Launch mobile SDK for iOS/Android',
            'Implement real-time collaboration features'
          ],
          status: 'planned'
        },
        {
          quarter: 'Q4 2024',
          milestones: [
            'Launch enterprise deployment options (on-prem)',
            'Achieve ISO 27001 certification',
            'Scale to 50K concurrent users'
          ],
          status: 'planned'
        }
      ],
      patents: {
        filed: 5,
        granted: 2,
        pending: 3,
        description: 'Core patents cover proprietary AI model optimization algorithms, hybrid multi-cloud orchestration system, and real-time inference engine. Two granted patents provide 17-year protection in US and key international markets.'
      },
      developmentMetrics: {
        teamSize: 8,
        deploymentFrequency: '2-3x per week',
        averageBugFixTime: '< 24 hours',
        testCoverage: 90,
        uptime: 99.95
      }
    },

    riskMap: {
      overallRiskScore: 75,
      riskLevel: 'medium',
      categories: [
        {
          name: 'Market Risk',
          score: 80,
          level: 'high',
          description: 'High competition and market volatility.'
        },
        {
          name: 'Financial Risk',
          score: 70,
          level: 'medium',
          description: 'Moderate financial risk due to high burn rate.'
        },
        {
          name: 'Operational Risk',
          score: 60,
          level: 'medium',
          description: 'Moderate operational risk with current team size.'
        },
        {
          name: 'Technical Risk',
          score: 85,
          level: 'high',
          description: 'High technical risk due to complex architecture.'
        }
      ],
      risks: [
        {
          title: 'Market Saturation',
          category: 'Market Risk',
          probability: 4,
          impact: 5,
          severity: 'high',
          description: 'High competition in the enterprise AI market.',
          mitigation: 'Focus on niche markets and unique value propositions.',
          owner: 'Marketing Team',
          status: 'monitoring'
        },
        {
          title: 'Funding Shortfall',
          category: 'Financial Risk',
          probability: 3,
          impact: 4,
          severity: 'medium',
          description: 'Risk of running out of funds before achieving profitability.',
          mitigation: 'Explore additional funding sources and reduce burn rate.',
          owner: 'Finance Team',
          status: 'mitigating'
        },
        {
          title: 'Operational Bottlenecks',
          category: 'Operational Risk',
          probability: 2,
          impact: 3,
          severity: 'medium',
          description: 'Potential bottlenecks in the current workflow.',
          mitigation: 'Implement process improvements and automation.',
          owner: 'Operations Team',
          status: 'resolved'
        },
        {
          title: 'Technical Debt',
          category: 'Technical Risk',
          probability: 5,
          impact: 4,
          severity: 'high',
          description: 'Accumulated technical debt in the codebase.',
          mitigation: 'Refactor critical components and improve documentation.',
          owner: 'Engineering Team',
          status: 'identified'
        }
      ],
      trend: 'stable',
      lastAssessment: '2023-10-15'
    },

    verificationChecklist: {
      overallCompletion: 85,
      totalItems: 20,
      completedItems: 17,
      partialItems: 2,
      missingItems: 1,
      criticalMissing: ['IP Assignment Agreements'],
      categories: [
        {
          name: 'Legal Documents',
          completion: 90,
          items: [
            { title: 'Term Sheet', status: 'complete', isCritical: true, description: 'Agreement outlining key terms and conditions of the investment.' },
            { title: 'Investor Rights Agreement', status: 'complete', isCritical: true, description: 'Agreement detailing the rights and obligations of the investor.' },
            { title: 'Shareholder Agreement', status: 'complete', isCritical: true, description: 'Agreement governing the rights and responsibilities of shareholders.' },
            { title: 'IP Assignment Agreements', status: 'missing', isCritical: true, description: 'Agreements transferring intellectual property rights to the company.' }
          ]
        },
        {
          name: 'Financial Documents',
          completion: 80,
          items: [
            { title: 'Financial Projections', status: 'complete', isCritical: true, description: 'Projected financial statements for the next 5 years.' },
            { title: 'Audit Reports', status: 'partial', isCritical: true, description: 'Recent audit reports for the company.' },
            { title: 'Tax Returns', status: 'complete', isCritical: true, description: 'Recent tax returns for the company.' }
          ]
        },
        {
          name: 'Operational Documents',
          completion: 95,
          items: [
            { title: 'Business Plan', status: 'complete', isCritical: true, description: 'Detailed business plan outlining the company\'s strategy and goals.' },
            { title: 'Marketing Plan', status: 'complete', isCritical: true, description: 'Marketing strategy and plan for the company.' },
            { title: 'Sales Plan', status: 'complete', isCritical: true, description: 'Sales strategy and plan for the company.' },
            { title: 'Operational Plan', status: 'complete', isCritical: true, description: 'Operational strategy and plan for the company.' }
          ]
        }
      ],
      lastReview: '2023-10-15'
    }
  };
}

// Section configurations
export const SECTION_CONFIG = {
  executiveSummary: {
    id: 'executive-summary',
    title: 'Executive Summary',
    pages: 2
  },
  goNoGo: {
    id: 'go-no-go',
    title: 'Go/No-Go Recommendation',
    pages: 1
  },
  roiSummary: {
    id: 'roi-summary',
    title: 'ROI Summary',
    pages: 1
  },
  marketAnalysis: {
    id: 'market-analysis',
    title: 'Market Analysis',
    pages: 3
  },
  financialAnalysis: {
    id: 'financial-analysis',
    title: 'Financial Analysis',
    pages: 4
  }
};