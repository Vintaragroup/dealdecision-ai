import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
        <div className="text-sm text-white/70">Loading…</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  // If an invite code was stored before auth (e.g. Google OAuth lost the redirect_url),
  // intercept here and send the user to the invite page to complete redemption.
  // InviteEntryPage clears this item from sessionStorage on mount.
  try {
    const pendingCode = sessionStorage.getItem('pending_invite_code');
    if (pendingCode) {
      return <Navigate to={`/invite?code=${encodeURIComponent(pendingCode)}`} replace />;
    }
  } catch { /* sessionStorage unavailable */ }

  return <>{children}</>;
}
