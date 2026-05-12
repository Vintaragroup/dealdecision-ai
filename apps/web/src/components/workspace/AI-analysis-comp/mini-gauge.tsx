interface MiniGaugeProps {
  label: string;
  score: number;
}

export function MiniGauge({ label, score }: MiniGaugeProps) {
  // Determine color based on score
  const getColor = () => {
    if (score >= 70) return 'bg-emerald-500';
    if (score >= 41) return 'bg-blue-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex flex-col items-center gap-2 min-w-[100px]">
      <div className="text-3xl font-bold text-white">{score}</div>
      <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${getColor()} transition-all duration-700 ease-out`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="text-[13px] font-medium text-zinc-400">{label}</div>
    </div>
  );
}
