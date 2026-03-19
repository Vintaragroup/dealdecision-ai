import { Navigate, Route, Routes } from 'react-router-dom';
import {
  SignedIn,
  SignedOut,
  SignIn,
} from '@clerk/clerk-react';

import AppShell from './AppShell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { OrgGate } from './components/auth/OrgGate';
import { SelectOrg } from './components/pages/SelectOrg';
import { AccessDeniedPage } from './components/auth/AccessDeniedPage';
import { InviteOnlyPage } from './components/auth/InviteOnlyPage';
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
      <Route
        path="/sign-in/*"
        element={
          <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-6 py-10">
            <div className="w-full max-w-md flex justify-center">
              {/* signUpUrl omitted intentionally — signup is invite-only.
                  The Clerk "Sign up" link inside the component is suppressed
                  by the absence of signUpUrl, which shows "Contact us" text.
                  The Clerk dashboard must also be set to "Restricted sign-ups" /
                  "Invite only" mode so that self-serve account creation is
                  blocked at the Clerk level, not just at the UI level. */}
              <SignIn
                routing="path"
                path="/sign-in"
                afterSignInUrl="/app"
              />
            </div>
          </div>
        }
      />

      {/* /sign-up is blocked — redirect to invite-only info page */}
      <Route path="/sign-up/*" element={<InviteOnlyPage />} />

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