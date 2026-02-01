import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';

export function OrgGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isLoaded, orgId } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
        <div className="text-sm text-white/70">Loading…</div>
      </div>
    );
  }

  if (orgId) return <>{children}</>;

  // Must have an active organization before accessing /app.
  // Preserve the intended destination so we can return after selecting an org.
  return <Navigate to="/app/select-org" replace state={{ from: location.pathname }} />;
}
