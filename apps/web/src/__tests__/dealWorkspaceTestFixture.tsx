import { render } from '@testing-library/react';
import React from 'react';
import { DealWorkspace } from '../components/pages/DealWorkspace';
import { ScoreSourceProvider } from '../contexts/ScoreSourceContext';

export const baseDeal = {
  id: 'deal-1',
  name: 'Demo Deal',
  company: 'Demo Co',
  type: 'series-a',
  stage: 'Series A',
  investmentAmount: 1000000,
  industry: 'SaaS',
  targetMarket: 'Enterprise',
  fundingAmount: '$1M',
  revenue: '$0',
  customers: '0',
  teamSize: '5',
  description: 'Demo',
  estimatedSavings: { money: 1000, hours: 10 },
} as const;

export const renderWorkspace = (overrides?: Partial<React.ComponentProps<typeof DealWorkspace>>) => {
  return render(
    <ScoreSourceProvider>
      <DealWorkspace
        darkMode={false}
        dealId="deal-1"
        dealData={baseDeal}
        {...overrides}
      />
    </ScoreSourceProvider>
  );
};
