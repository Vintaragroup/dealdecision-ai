import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import {
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
} from '@clerk/clerk-react';

import AppShell from './AppShell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { OrgGate } from './components/auth/OrgGate';
import { SelectOrg } from './components/pages/SelectOrg';
import { AccessDeniedPage } from './components/auth/AccessDeniedPage';
import { InviteEntryPage } from './components/auth/InviteEntryPage';
function PublicHome() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-xl w-full space-y-6">
        <h1 className="text-3xl font-semibold">DealDecision AI</h1>
        <p className="text-white/70">Sign in to access your deal workspace.</p>
        <div className="flex gap-3">
          <a className="px-4 py-2 rounded bg-[#6366f1] text-white no-underline" href="/sign-in">
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}

function ProtectedApp() {
  return (
    <ProtectedRoute>
      <OrgGate>
        <AppShell />
      </OrgGate>
    </ProtectedRoute>
  );
}

/**
 * Reads `redirect_url` from the query string and passes it to Clerk's
 * afterSignInUrl / afterSignUpUrl so the user returns to the invite page
 * (or wherever they came from) after authentication.
 *
 * Security: only relative URLs starting with '/' are accepted; anything
 * else falls back to '/app'.
 */
function safeRedirectUrl(raw: string | null): string {
  if (typeof raw === 'string' && raw.startsWith('/')) return raw;
  return '/app';
}

function SignInPage() {
  const [params] = useSearchParams();
  const afterUrl = safeRedirectUrl(params.get('redirect_url'));
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-6 py-10">
      <div className="w-full max-w-md flex justify-center">
        <SignIn
          routing="path"
          path="/sign-in"
          afterSignInUrl={afterUrl}
          signUpUrl="/sign-up"
        />
      </div>
    </div>
  );
}

/**
 * Sign-up page: renders Clerk's SignUp component with the same redirect_url
 * preservation so new users land back on the invite page after account creation.
 *
 * Note: Clerk must be configured with "Public" sign-ups (not Restricted) in
 * the Clerk dashboard for new users to be able to complete registration.
 * Platform access is gated by platform_access, not by Clerk's invite system.
 */
function SignUpPage() {
  const [params] = useSearchParams();
  const afterUrl = safeRedirectUrl(params.get('redirect_url'));
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-6 py-10">
      <div className="w-full max-w-md flex justify-center">
        <SignUp
          routing="path"
          path="/sign-up"
          afterSignUpUrl={afterUrl}
          signInUrl="/sign-in"
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route
        path="/"
        element={
          <>
            <SignedIn>
              <Navigate to="/app" replace />
            </SignedIn>
            <SignedOut>
              <PublicHome />
            </SignedOut>
          </>
        }
      />
      <Route path="/sign-in/*" element={<SignInPage />} />

      {/* Sign-up: Clerk account creation for invited users.
          Requires Clerk dashboard to be set to "Public" sign-ups.
          Platform-level access is still gated by platform_access — a new
          account without a redeemed invite lands on ACCESS_NOT_PROVISIONED. */}
      <Route path="/sign-up/*" element={<SignUpPage />} />

      {/* Access denied states (returned by backend after successful Clerk auth) */}
      <Route path="/access-denied" element={<AccessDeniedPage />} />

      {/* Invite code redemption — public, no auth required */}
      <Route path="/invite" element={<InviteEntryPage />} />

      {/* System admin — redirect legacy standalone route to in-shell route */}
      <Route path="/system/admin" element={<Navigate to="/app/admin" replace />} />

      {/* Protected */}
      <Route
        path="/app/select-org"
        element={
          <ProtectedRoute>
            <SelectOrg />
          </ProtectedRoute>
        }
      />
      <Route path="/app/*" element={<ProtectedApp />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}