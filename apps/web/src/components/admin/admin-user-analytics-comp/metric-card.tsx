interface MetricCardProps {
  label: string;
  value: string | number;
  helperText?: string;
  state?: 'normal' | 'highlighted' | 'unavailable';
}

export function MetricCard({ label, value, helperText, state = 'normal' }: MetricCardProps) {
  const stateStyles = {
    normal: 'bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]',
    highlighted: 'bg-gradient-to-br from-blue-950/50 to-blue-900/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] ring-1 ring-blue-500/30',
    unavailable: 'bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] opacity-60',
  };

  const valueStyles = {
    normal: 'text-white',
    highlighted: 'text-white',
    unavailable: 'text-zinc-500',
  };

  const helperStyles = {
    normal: 'text-blue-400',
    highlighted: 'text-blue-400',
    unavailable: 'text-zinc-500',
  };

  return (
    <div
      className={`
        rounded-[14px] p-6 transition-all
        ${stateStyles[state]}
      `}
    >
      <div className="text-xs uppercase tracking-wider text-zinc-400 mb-2">
        {label}
      </div>
      <div className={`text-3xl mb-1 ${valueStyles[state]}`}>
        {state === 'unavailable' ? '--' : value}
      </div>
      {helperText && (
        <div className={`text-sm ${helperStyles[state]}`}>
          {helperText}
        </div>
      )}
    </div>
  );
}