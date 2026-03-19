/**
 * InviteOnlyPage
 *
 * Shown when a user navigates to /sign-up directly.
 * Signup is invite-only — this page explains that and
 * links back to sign-in.
 */

const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'access@dealdecision.ai';

export function InviteOnlyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Access is invite-only</h1>
          <p className="text-white/60 text-sm leading-relaxed">
            DealDecision AI is currently available by invitation only.
            If you have received an invite, sign in with the email
            address your invite was sent to.
          </p>
        </div>

        <div className="pt-2">
          <a
            href="/sign-in"
            className="inline-block px-5 py-2.5 rounded bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f52cc] transition-colors"
          >
            Sign in
          </a>
        </div>

        <p className="text-white/30 text-xs">
          Need access?{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline hover:text-white/60 transition-colors"
          >
            Contact your account executive
          </a>
        </p>
      </div>
    </div>
  );
}
