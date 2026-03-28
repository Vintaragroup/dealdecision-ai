import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import AdminControlPanel from '../components/pages/SystemAdminPage';

const mockApiGetMyAccess = vi.fn();

vi.mock('../lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/apiClient')>('../lib/apiClient');
  return {
    ...actual,
    apiGetMyAccess: (...args: unknown[]) => mockApiGetMyAccess(...args),
  };
});

vi.mock('../components/admin/UsersTable', () => ({
  UsersTable: ({ onViewAnalytics }: { onViewAnalytics?: (user: unknown) => void }) => (
    <div>
      <div>UsersTableMock</div>
      <button
        onClick={() =>
          onViewAnalytics?.({
            clerk_user_id: 'user-123',
            email: 'analyst@example.com',
            full_name: 'Analyst User',
            clerk_created_at: null,
            id: 'pa-1',
            org_id: 'org-1',
            access_status: 'active',
            access_expires_at: null,
            is_admin: false,
            account_role: 'analyst',
            grant_source: 'invite',
            notes: null,
            granted_by_user_id: null,
            created_at: null,
            updated_at: null,
          })
        }
      >
        Open Analytics
      </button>
    </div>
  ),
}));

vi.mock('../components/admin/admin-user-analytics', () => ({
  AdminUserAnalyticsDetailView: ({ user, onBack }: { user: { clerk_user_id: string }; onBack?: () => void }) => (
    <div>
      <div>AnalyticsDetailMock:{user.clerk_user_id}</div>
      <button onClick={onBack}>Back to users</button>
    </div>
  ),
}));

vi.mock('../components/admin/InvitesTable', () => ({ InvitesTable: () => <div /> }));
vi.mock('../components/admin/InviteCreationPanel', () => ({ InviteCreationPanel: () => <div /> }));
vi.mock('../components/admin/RecoveryCenter', () => ({ RecoveryCenter: () => <div /> }));
vi.mock('../components/admin/AuditLogsPanel', () => ({ AuditLogsPanel: () => <div /> }));
vi.mock('../components/admin/OrgManagementPanel', () => ({ OrgManagementPanel: () => <div /> }));
vi.mock('../components/admin/SuperAdminOpsPanel', () => ({ SuperAdminOpsPanel: () => <div /> }));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

describe('SystemAdminPage users analytics navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGetMyAccess.mockResolvedValue({
      is_admin: true,
      account_role: 'admin',
    });
  });

  test('transitions from users list to analytics detail and back within users tab', async () => {
    render(
      <MemoryRouter initialEntries={['/admin?tab=users']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <>
                <AdminControlPanel />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('UsersTableMock')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Open Analytics'));

    await waitFor(() => {
      expect(screen.getByText('AnalyticsDetailMock:user-123')).toBeInTheDocument();
      expect(screen.queryByText('UsersTableMock')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('location-search').textContent).toContain('tab=users');
    expect(screen.getByTestId('location-search').textContent).toContain('analytics_user=user-123');

    fireEvent.click(screen.getByText('Back to users'));

    await waitFor(() => {
      expect(screen.getByText('UsersTableMock')).toBeInTheDocument();
      expect(screen.queryByText('AnalyticsDetailMock:user-123')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('location-search').textContent).toContain('tab=users');
    expect(screen.getByTestId('location-search').textContent).not.toContain('analytics_user=');
  });
});
