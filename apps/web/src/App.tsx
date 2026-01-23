import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import {
  OrganizationSwitcher,
  RedirectToSignIn,
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  useAuth,
} from '@clerk/clerk-react';

import AppShell from './AppShell';

function PublicHome() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-xl w-full space-y-6">
        <h1 className="text-3xl font-semibold">DealDecision AI</h1>
        <p className="text-white/70">Sign in to access your deal workspace.</p>
        <div className="flex gap-3">
          <Link className="px-4 py-2 rounded bg-[#6366f1]" to="/sign-in">
            Sign in
          </Link>
          <Link className="px-4 py-2 rounded border border-white/20" to="/sign-up">
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}

function OrgGate({ children }: { children: ReactNode }) {
  const { orgId } = useAuth();
  if (orgId) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-xl w-full space-y-4">
        <h1 className="text-2xl font-semibold">Select a team</h1>
        <p className="text-white/70">
          This app uses Clerk Organizations. Select or create an organization to continue.
        </p>
        <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/app" />
      </div>
    </div>
  );
}

function ProtectedApp() {
  return (
    <>
      <SignedIn>
        <OrgGate>
          <AppShell />
        </OrgGate>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn redirectUrl="/app" />
      </SignedOut>
    </>
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
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            afterSignInUrl="/app"
            afterSignUpUrl="/app"
          />
        }
      />
      <Route
        path="/sign-up/*"
        element={
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            afterSignInUrl="/app"
            afterSignUpUrl="/app"
          />
        }
      />

      {/* Protected */}
      <Route path="/app/*" element={<ProtectedApp />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}