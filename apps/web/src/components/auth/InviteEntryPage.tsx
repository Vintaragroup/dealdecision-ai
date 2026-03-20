/**
 * InviteEntryPage
 *
 * Handles the /invite?code=<hex> flow end-to-end:
 *
 * Unauthenticated user:
 *   - Shows invite info (validates code against backend without mutating)
 *   - "Sign in to redeem" → /sign-in?redirect_url=/invite?code=<code>
 *
 * Authenticated user:
 *   - Shows access preview (duration, email restriction if any)
 *   - "Activate access" → POST /api/v1/invites/redeem → navigate to /app
 *
 * Error states: INVITE_NOT_FOUND, INVITE_EXPIRED, INVITE_REVOKED,
 *   INVITE_ALREADY_REDEEMED, INVITE_EMAIL_MISMATCH, ALREADY_HAS_ACCESS
 */
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { apiValidateInvite, apiRedeemInvite } from '../../lib/apiClient';

type PageState =
  | { phase: 'loading' }
  | { phase: 'enter_code' }              // no code in URL, show input
  | { phase: 'preview'; durationDays: number; emailRestricted: boolean }  // valid, signed in
  | { phase: 'preview_signedout'; durationDays: number }                   // valid, not signed in
  | { phase: 'redeeming' }
  | { phase: 'success'; expiresAt: string }
  | { phase: 'error'; errorCode: string; title: string; body: string; allowRetry?: boolean };

const DENIAL_MESSAGES: Record<string, { title: string; body: string }> = {
  INVITE_NOT_FOUND: {
    title: 'Invite code not found',
    body: 'This invite code does not exist. Check the link you received and try again.',
  },
  INVITE_EXPIRED: {
    title: 'Invite code expired',
    body: 'This invite code has passed its expiry date. Contact your account executive for a new one.',
  },
  INVITE_REVOKED: {
    title: 'Invite code revoked',
    body: 'This invite code has been revoked. Contact your account executive for assistance.',
  },
  INVITE_ALREADY_REDEEMED: {
    title: 'Invite already redeemed',
    body: 'This invite code has already been used. If you think this is an error, contact your account executive.',
  },
  INVITE_EMAIL_MISMATCH: {
    title: 'Email mismatch',
    body: 'This invite code was sent to a different email address. Sign in with the email address your invite was sent to.',
  },
  INVITE_EMAIL_UNVERIFIABLE: {
    title: 'Email could not be verified',
    body: 'This invite is restricted to a specific email address, but your sign-in method does not expose your email. Sign in with an email/password account, or contact your account executive.',
  },
  ALREADY_HAS_ACCESS: {
    title: 'Access already active',
    body: 'Your account already has active access to the platform.',
  },
  ACCESS_REVOKED: {
    title: 'Access revoked',
    body: 'Your platform access has been revoked. Contact your account executive to re-enable access.',
  },
};

const DEFAULT_ERROR = {
  title: 'Something went wrong',
  body: 'Unable to process this invite code. Please try again or contact your account executive.',
};

const CONTACT_EMAIL =
  (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'access@dealdecision.ai';

function formatAccessExpiry(expiresAt: string): string {
  try {
    return new Date(expiresAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return expiresAt;
  }
}

export function InviteEntryPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isSignedIn, isLoaded } = useAuth();

  const [codeInput, setCodeInput] = useState('');
  // Resolve initial code: URL param takes priority, then sessionStorage (survives OAuth redirects).
  const [code, setCode] = useState<string | null>(() => {
    const urlCode = params.get('code');
    try {
      const stored = sessionStorage.getItem('pending_invite_code');
      if (stored) sessionStorage.removeItem('pending_invite_code'); // always clear
      return urlCode ?? stored;
    } catch {
      return urlCode;
    }
  });
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const validatedRef = useRef<string | null>(null);

  // Validate the code once we know auth state and have a code
  useEffect(() => {
    if (!isLoaded) return;
    if (!code) {
      setState({ phase: 'enter_code' });
      return;
    }
    // Avoid re-validating the same code
    if (validatedRef.current === code) return;
    validatedRef.current = code;

    setState({ phase: 'loading' });
    apiValidateInvite(code)
      .then((res) => {
        if (!res.valid) {
          const denial = DENIAL_MESSAGES[res.reason ?? ''] ?? DEFAULT_ERROR;
          const allowRetry = res.reason === 'ALREADY_HAS_ACCESS';
          setState({ phase: 'error', errorCode: res.reason ?? '', ...denial, allowRetry });
          return;
        }
        const durationDays = res.access_duration_days ?? 7;
        const emailRestricted = res.email_restricted ?? false;
        if (isSignedIn) {
          setState({ phase: 'preview', durationDays, emailRestricted });
        } else {
          setState({ phase: 'preview_signedout', durationDays });
        }
      })
      .catch(() => {
        setState({ phase: 'error', errorCode: '', ...DEFAULT_ERROR, allowRetry: true });
      });
  }, [isLoaded, isSignedIn, code]);

  const handleValidateError = () => {
    setState({ phase: 'error', errorCode: '', ...DEFAULT_ERROR, allowRetry: true });
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    validatedRef.current = null;
    setCode(trimmed);
  };

  const handleRedeem = () => {
    if (!code) return;
    setState({ phase: 'redeeming' });
    apiRedeemInvite(code)
      .then((res) => {
        setState({ phase: 'success', expiresAt: res.access_expires_at });
        setTimeout(() => navigate('/app', { replace: true }), 2000);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : '';
        // Parse error code from HTTP error message body
        const codeMatch = msg.match(/("code"\s*:\s*"([A-Z_]+)")/);
        const errCode = codeMatch?.[2] ?? '';
        const denial = DENIAL_MESSAGES[errCode] ?? DEFAULT_ERROR;
      setState({ phase: 'error', errorCode: errCode, ...denial, allowRetry: false });
      });
  };

  const handleGoToSignIn = () => {
    // Store code before leaving — OAuth redirects can lose the redirect_url query param.
    if (code) { try { sessionStorage.setItem('pending_invite_code', code); } catch { /* ignore */ } }
    const returnUrl = code ? `/invite?code=${encodeURIComponent(code)}` : '/invite';
    window.location.href = `/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`;
  };

  const handleGoToSignUp = () => {
    if (code) { try { sessionStorage.setItem('pending_invite_code', code); } catch { /* ignore */ } }
    const returnUrl = code ? `/invite?code=${encodeURIComponent(code)}` : '/invite';
    window.location.href = `/sign-up?redirect_url=${encodeURIComponent(returnUrl)}`;
  };

  const handleGoToApp = () => navigate('/app', { replace: true });

  const handleRetry = () => {
    validatedRef.current = null;
    setCode(null);
    setCodeInput('');
    setState({ phase: 'enter_code' });
  };

  const renderContent = () => {
    switch (state.phase) {
      case 'loading':
        return (
          <div className="space-y-3 text-center">
            <div className="text-white/40 text-sm animate-pulse">Checking invite code…</div>
          </div>
        );

      case 'enter_code':
        return (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">Redeem your invite</h1>
              <p className="text-white/60 text-sm leading-relaxed">
                Enter your invite code to activate access to DealDecision AI.
              </p>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Paste invite code"
                className="w-full px-4 py-3 rounded bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 transition"
                autoFocus
              />
              <button
                type="submit"
                disabled={!codeInput.trim()}
                className="w-full px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Continue
              </button>
            </div>
            <p className="text-white/30 text-xs text-center">
              Need access?{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="underline hover:text-white/60 transition-colors"
              >
                Contact your account executive
              </a>
            </p>
          </form>
        );

      case 'preview_signedout':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <div className="text-green-400 text-3xl mb-2">✓</div>
              <h1 className="text-2xl font-semibold">Invite code valid</h1>
              <p className="text-white/60 text-sm leading-relaxed">
                This invite grants <span className="text-white font-medium">{state.durationDays} days</span> of platform access.
                Sign in or create an account to activate it.
              </p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              <button
                type="button"
                onClick={handleGoToSignIn}
                className="w-full max-w-xs px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
              >
                Sign in to activate
              </button>
              <button
                type="button"
                onClick={handleGoToSignUp}
                className="w-full max-w-xs px-5 py-2.5 rounded bg-white/10 border border-white/15 text-white text-sm font-medium hover:bg-white/15 transition-colors"
              >
                Create account
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="text-white/30 text-xs hover:text-white/60 transition-colors underline"
              >
                Use a different code
              </button>
            </div>
          </div>
        );

      case 'preview':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <div className="text-green-400 text-3xl mb-2">✓</div>
              <h1 className="text-2xl font-semibold">Invite code ready</h1>
              <p className="text-white/60 text-sm leading-relaxed">
                This invite grants{' '}
                <span className="text-white font-medium">{state.durationDays} days</span> of platform access.
                {state.emailRestricted && (
                  <span> It is restricted to your account email address.</span>
                )}
              </p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              <button
                type="button"
                onClick={handleRedeem}
                className="px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
              >
                Activate access
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="text-white/30 text-xs hover:text-white/60 transition-colors underline"
              >
                Use a different code
              </button>
            </div>
          </div>
        );

      case 'redeeming':
        return (
          <div className="space-y-3 text-center">
            <div className="text-white/40 text-sm animate-pulse">Activating access…</div>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <div className="text-green-400 text-4xl mb-2">✓</div>
              <h1 className="text-2xl font-semibold">Access activated</h1>
              <p className="text-white/60 text-sm leading-relaxed">
                Your access is active until{' '}
                <span className="text-white font-medium">{formatAccessExpiry(state.expiresAt)}</span>.
                Redirecting you now…
              </p>
            </div>
            <button
              type="button"
              onClick={handleGoToApp}
              className="px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
            >
              Go to dashboard
            </button>
          </div>
        );

      case 'error':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <div className="text-amber-400 text-4xl mb-4">⚠</div>
              <h1 className="text-2xl font-semibold">{state.title}</h1>
              <p className="text-white/60 text-sm leading-relaxed">{state.body}</p>
            </div>
            <div className="flex flex-col gap-3 items-center">
              {state.errorCode === 'ALREADY_HAS_ACCESS' ? (
                // User already has active access — go to app, don't contact AE
                <button
                  type="button"
                  onClick={handleGoToApp}
                  className="px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
                >
                  Go to dashboard
                </button>
              ) : state.allowRetry ? (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
                >
                  Try a different code
                </button>
              ) : (
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="inline-block px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
                >
                  Contact your AE
                </a>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-md w-full space-y-6">{renderContent()}</div>
    </div>
  );
}
