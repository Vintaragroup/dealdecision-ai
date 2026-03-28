interface StatusBadgeProps {
  label: string;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'premium';
}

export function StatusBadge({ label, variant = 'neutral' }: StatusBadgeProps) {
  const variantStyles = {
    success: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30',
    danger: 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30',
    info: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30',
    neutral: 'bg-zinc-700/50 text-zinc-300 ring-1 ring-zinc-600/50',
    premium: 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs ${variantStyles[variant]}`}>
      {label}
    </span>
  );
}
