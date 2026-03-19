import React, { useState } from 'react';
import { Mail, Copy, Check, AlertCircle } from 'lucide-react';
import { apiAdminCreateInvite, AdminCreateInviteBody } from '../../lib/apiClient';

// Allowed durations as defined by the backend (invites.ts ALLOWED_DURATIONS)
const ALLOWED_DURATIONS = [3, 5, 7, 14] as const;
type AllowedDuration = typeof ALLOWED_DURATIONS[number];

interface InviteCreationPanelProps {
  onCreated?: () => void;
}

export function InviteCreationPanel({ onCreated }: InviteCreationPanelProps) {
  const [email, setEmail] = useState('');
  const [duration, setDuration] = useState<AllowedDuration>(7);
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateInvite = async () => {
    setLoading(true);
    setError(null);
    setGeneratedLink('');
    try {
      const body: AdminCreateInviteBody = { access_duration_days: duration };
      if (email.trim()) body.email = email.trim();

      const result = await apiAdminCreateInvite(body);
      const code = result.record.code;
      if (!code) throw new Error('No invite code returned from server');

      const link = `${window.location.origin}/invite/${code}`;
      setGeneratedLink(link);
      onCreated?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create invite';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
      <div className="flex items-center gap-2 mb-6">
        <Mail className="w-5 h-5 text-blue-400" strokeWidth={1.5} />
        <h3 className="text-lg font-semibold text-white">Create New Invite</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            Email (Optional)
          </label>
          <input
            type="email"
            placeholder="user@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 disabled:opacity-50"
          />
        </div>

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            Access Duration
          </label>
          <select
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value, 10) as AllowedDuration)}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 disabled:opacity-50"
          >
            {ALLOWED_DURATIONS.map((d) => (
              <option key={d} value={String(d)}>{d} days</option>
            ))}
          </select>
        </div>

        {/* Generate Button */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-2">
            &nbsp;
          </label>
          <button
            onClick={() => void generateInvite()}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Generate Invite'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-red-400 p-3 bg-red-400/10 rounded-lg border border-red-400/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
          {error}
        </div>
      )}

      {/* Generated Link */}
      {generatedLink && (
        <div className="mt-6 p-4 bg-zinc-900/50 border border-zinc-700 rounded-lg">
          <p className="text-xs text-zinc-400 mb-2">Generated Invite Link</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={generatedLink}
              readOnly
              className="flex-1 px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded text-sm text-zinc-300 font-mono"
            />
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" strokeWidth={1.5} />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" strokeWidth={1.5} />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
