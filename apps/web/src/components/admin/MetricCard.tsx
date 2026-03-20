import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  trend?: string;
}

export function MetricCard({ label, value, icon: Icon, trend }: MetricCardProps) {
  return (
    <div className="rounded-[14px] bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-lg bg-zinc-700/50">
          <Icon className="w-5 h-5 text-blue-400" strokeWidth={1.5} />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-3xl font-semibold text-white">{value}</p>
        <p className="text-sm text-zinc-400">{label}</p>
        {trend && (
          <p className="text-xs text-zinc-500 mt-2">{trend}</p>
        )}
      </div>
    </div>
  );
}
