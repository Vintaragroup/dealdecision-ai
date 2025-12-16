import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import { DealWorkspace } from '../components/pages/DealWorkspace';

vi.mock('../contexts/UserRoleContext', () => ({
  useUserRole: () => ({ isFounder: true, isInvestor: false }),
}));

beforeAll(() => {
  // JSDOM lacks scrollIntoView; stub for assistant panel auto-scroll.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const baseDeal = {
  id: 'deal-1',
  name: 'Demo Deal',
  company: 'Demo Co',
  type: 'series-a',
  stage: 'growth',
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

describe('DealWorkspace Job Center (live mode)', () => {
  const renderWorkspace = (overrides?: Partial<React.ComponentProps<typeof DealWorkspace>>) => {
    return render(
      <DealWorkspace
        darkMode={false}
        dealId="deal-1"
        dealData={baseDeal}
        {...overrides}
      />
    );
  };

  test('renders deal header details', () => {
    renderWorkspace();

    expect(screen.getByText(/Demo Deal/i)).toBeInTheDocument();
    expect(screen.getByText(/Series A/i)).toBeInTheDocument();
    expect(screen.getByText(/24 views, 5 interested, 2 meetings/i)).toBeInTheDocument();
  });

  test('opens AI assistant panel when clicked', async () => {
    renderWorkspace();

    await userEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));

    expect(await screen.findByText(/AI Deal Assistant/i)).toBeInTheDocument();
  });

  test('Run Analysis shows loading state', async () => {
    renderWorkspace({ dealId: 'deal-4' });

    const [headerRunButton] = screen.getAllByRole('button', { name: /Run Analysis/i });
    await userEvent.click(headerRunButton);

    await waitFor(() => {
      expect(headerRunButton).toHaveTextContent(/Analyzing.../i);
    });
  });
});
