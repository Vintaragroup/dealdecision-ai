import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { UsersTable } from '../components/admin/UsersTable';

const mockApiAdminListUsers = vi.fn();
const mockApiAdminSetAdminStatus = vi.fn();
const mockApiAdminRevokeAccess = vi.fn();
const mockApiAdminExtendAccess = vi.fn();
const mockApiAdminSetAccountRole = vi.fn();
const mockApiAdminProvisionUser = vi.fn();

vi.mock('../lib/apiClient', () => ({
  apiAdminListUsers: (...args: unknown[]) => mockApiAdminListUsers(...args),
  apiAdminSetAdminStatus: (...args: unknown[]) => mockApiAdminSetAdminStatus(...args),
  apiAdminRevokeAccess: (...args: unknown[]) => mockApiAdminRevokeAccess(...args),
  apiAdminExtendAccess: (...args: unknown[]) => mockApiAdminExtendAccess(...args),
  apiAdminSetAccountRole: (...args: unknown[]) => mockApiAdminSetAccountRole(...args),
  apiAdminProvisionUser: (...args: unknown[]) => mockApiAdminProvisionUser(...args),
}));

describe('UsersTable analytics entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockApiAdminListUsers.mockResolvedValue({
      clerkAvailable: true,
      total: 1,
      records: [
        {
          clerk_user_id: 'user-123',
          email: 'analyst@example.com',
          full_name: 'Analyst User',
          clerk_created_at: new Date().toISOString(),
          id: 'pa-1',
          org_id: 'org-1',
          access_status: 'active',
          access_expires_at: null,
          is_admin: false,
          account_role: 'analyst',
          grant_source: 'invite',
          notes: null,
          granted_by_user_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
  });

  test('invokes onViewAnalytics when selecting View Analytics action', async () => {
    const onViewAnalytics = vi.fn();

    render(<UsersTable searchQuery="" onViewAnalytics={onViewAnalytics} />);

    await waitFor(() => {
      expect(screen.getByText('Analyst User')).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('View Analytics')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('View Analytics'));

    expect(onViewAnalytics).toHaveBeenCalledTimes(1);
    expect(onViewAnalytics.mock.calls[0]?.[0]?.clerk_user_id).toBe('user-123');
  });
});
