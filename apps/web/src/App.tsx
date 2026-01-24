import { Link, Navigate, Route, Routes } from 'react-router-dom';
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
              <SignIn
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                afterSignInUrl="/app"
                afterSignUpUrl="/app"
              />
            </div>
          </div>
        }
      />
      <Route
        path="/sign-up/*"
        element={
          <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-6 py-10">
            <div className="w-full max-w-md flex justify-center">
              <SignUp
                routing="path"
                path="/sign-up"
                signInUrl="/sign-in"
                afterSignInUrl="/app"
                afterSignUpUrl="/app"
              />
            </div>
          </div>
        }
      />

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