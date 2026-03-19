import React from 'react';

type StatusType = 'active' | 'pending' | 'expired' | 'revoked' | 'redeemed';

interface StatusPillProps {
  status: StatusType;
}

export function StatusPill({ status }: StatusPillProps) {
  const styles = {
    active: 'bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.3)]',
    pending: 'bg-amber-500/20 text-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.3)]',
    expired: 'bg-zinc-500/20 text-zinc-400 shadow-[0_0_12px_rgba(161,161,170,0.2)]',
    revoked: 'bg-red-500/20 text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.3)]',
    redeemed: 'bg-blue-500/20 text-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.3)]',
  };

  const labels = {
    active: 'Active',
    pending: 'Pending',
    expired: 'Expired',
    revoked: 'Revoked',
    redeemed: 'Redeemed',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
