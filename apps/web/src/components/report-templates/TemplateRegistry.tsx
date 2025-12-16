// Template Registry - All available report templates
import { ExecutiveSummary } from './sections/ExecutiveSummary';
import { MarketAnalysis } from './sections/MarketAnalysis';
import { FinancialAnalysis } from './sections/FinancialAnalysis';
import { TeamAssessment } from './sections/TeamAssessment';
import { CompetitiveLandscape } from './sections/CompetitiveLandscape';
import { ROISummary } from './sections/ROISummary';
import { RiskAssessment } from './sections/RiskAssessment';
import { TechnologyStack } from './sections/TechnologyStack';
import { ProductRoadmap } from './sections/ProductRoadmap';
import { GoToMarketStrategy } from './sections/GoToMarketStrategy';
import { CustomerAnalysis } from './sections/CustomerAnalysis';
import { SWOTAnalysis } from './sections/SWOTAnalysis';
import { InvestmentTerms } from './sections/InvestmentTerms';

export interface TemplateSection {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType<{ data: any; darkMode: boolean }>;
  category: 'essential' | 'financial' | 'strategic' | 'operational';
  icon: string;
}

export const templateRegistry: TemplateSection[] = [
  {
    id: 'executive-summary',
    name: 'Executive Summary',
    description: 'High-level overview of the investment opportunity',
    component: ExecutiveSummary,
    category: 'essential',
    icon: 'FileText'
  },
  {
    id: 'market-analysis',
    name: 'Market Analysis',
    description: 'Total addressable market, growth trends, and opportunity',
    component: MarketAnalysis,
    category: 'strategic',
    icon: 'TrendingUp'
  },
  {
    id: 'financial-projections',
    name: 'Financial Analysis',
    description: 'Revenue forecasts, burn, margins, and path to profitability',
    component: FinancialAnalysis,
    category: 'financial',
    icon: 'DollarSign'
  },
  {
    id: 'team-analysis',
    name: 'Team Assessment',
    description: 'Founding team, advisors, and organizational structure',
    component: TeamAssessment,
    category: 'essential',
    icon: 'Users'
  },
  {
    id: 'competitive-landscape',
    name: 'Competitive Landscape',
    description: 'Competitor analysis and market positioning',
    component: CompetitiveLandscape,
    category: 'strategic',
    icon: 'Target'
  },
  {
    id: 'roi-summary',
    name: 'ROI Summary',
    description: 'Expected returns and value creation analysis',
    component: ROISummary,
    category: 'financial',
    icon: 'TrendingUp'
  },
  {
    id: 'risk-assessment',
    name: 'Risk Assessment',
    description: 'Comprehensive risk analysis and mitigation strategies',
    component: RiskAssessment,
    category: 'essential',
    icon: 'AlertTriangle'
  },
  {
    id: 'technology-stack',
    name: 'Technology Stack',
    description: 'Technical architecture and scalability analysis',
    component: TechnologyStack,
    category: 'operational',
    icon: 'Code'
  },
  {
    id: 'product-roadmap',
    name: 'Product Roadmap',
    description: 'Product development timeline and milestones',
    component: ProductRoadmap,
    category: 'strategic',
    icon: 'Map'
  },
  {
    id: 'go-to-market-strategy',
    name: 'Go-to-Market Strategy',
    description: 'Customer acquisition and growth strategy',
    component: GoToMarketStrategy,
    category: 'strategic',
    icon: 'Rocket'
  },
  {
    id: 'customer-analysis',
    name: 'Customer Analysis',
    description: 'Customer base, satisfaction, and retention metrics',
    component: CustomerAnalysis,
    category: 'operational',
    icon: 'Users'
  },
  {
    id: 'swot-analysis',
    name: 'SWOT Analysis',
    description: 'Strengths, weaknesses, opportunities, and threats',
    component: SWOTAnalysis,
    category: 'strategic',
    icon: 'Shield'
  },
  {
    id: 'investment-terms',
    name: 'Investment Terms',
    description: 'Term sheet summary and deal structure',
    component: InvestmentTerms,
    category: 'financial',
    icon: 'FileText'
  }
];

export const getTemplateById = (id: string): TemplateSection | undefined => {
  return templateRegistry.find(template => template.id === id);
};

export const getTemplatesByCategory = (category: string): TemplateSection[] => {
  return templateRegistry.filter(template => template.category === category);
};

export const getEssentialTemplates = (): TemplateSection[] => {
  return getTemplatesByCategory('essential');
};

export const getFinancialTemplates = (): TemplateSection[] => {
  return getTemplatesByCategory('financial');
};

export const getStrategicTemplates = (): TemplateSection[] => {
  return getTemplatesByCategory('strategic');
};

export const getOperationalTemplates = (): TemplateSection[] => {
  return getTemplatesByCategory('operational');
};
