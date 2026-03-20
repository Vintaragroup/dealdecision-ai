/**
 * AccessDeniedPage
 *
 * Shown when the backend returns a platform-access denial code after
 * successful Clerk authentication.
 *
 * Error codes returned by the API:
 *   ACCESS_PENDING           — account created but not yet approved
 *   ACCESS_EXPIRED           — access window has closed
 *   ACCESS_REVOKED           — access was manually revoked
 *   ACCESS_NOT_PROVISIONED   — no platform_access record exists yet
 *
 * The page reads the `code` query parameter set by ProtectedRoute when
 * it intercepts one of these codes from the API.
 */
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';

type DenialCode =
  | 'ACCESS_PENDING'
  | 'ACCESS_EXPIRED'
  | 'ACCESS_REVOKED'
  | 'ACCESS_NOT_PROVISIONED'
  | string;

const MESSAGES: Record<string, { title: string; body: string }> = {
  ACCESS_PENDING: {
    title: 'Access pending',
    body: 'Your account has been created but is not yet approved. Your account executive will activate your access shortly.',
  },
  ACCESS_EXPIRED: {
    title: 'Access expired',
    body: 'Your access window has ended. Contact your account executive to request an extension.',
  },
  ACCESS_REVOKED: {
    title: 'Access revoked',
    body: 'Your access to this platform has been revoked. Contact your account executive if you believe this is an error.',
  },
  ACCESS_NOT_PROVISIONED: {
    title: 'Access not provisioned',
    body: 'Your account exists but has not been granted platform access. Contact your account executive to get started.',
  },
};

const DEFAULT_MESSAGE = {
  title: 'Access denied',
  body: 'You do not currently have access to this platform. Contact your account executive for assistance.',
};

const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'access@dealdecision.ai';

export function AccessDeniedPage() {
  const [params] = useSearchParams();
  const { signOut } = useAuth();
  const code: DenialCode = params.get('code') ?? 'ACCESS_NOT_PROVISIONED';
  const { title, body } = MESSAGES[code] ?? DEFAULT_MESSAGE;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="space-y-2">
          <div className="text-amber-400 text-4xl mb-4">⚠</div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-white/60 text-sm leading-relaxed">{body}</p>
          {code && (
            <p className="text-white/20 text-xs font-mono">code: {code}</p>
          )}
        </div>

        <div className="pt-2 flex flex-col gap-3 items-center">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-block px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
          >
            Contact your AE
          </a>
          {(code === 'ACCESS_NOT_PROVISIONED' || code === 'ACCESS_PENDING') && (
            <a
              href="/invite"
              className="text-white/40 text-xs hover:text-white/70 transition-colors underline"
            >
              Have an invite code?
            </a>
          )}
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            className="text-white/40 text-xs hover:text-white/70 transition-colors underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
