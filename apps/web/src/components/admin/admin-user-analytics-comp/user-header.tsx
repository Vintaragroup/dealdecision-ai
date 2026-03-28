import { useState } from 'react';
import { StatusBadge } from './status-badge';
import { ChevronDown, Shield, Clock, Mail, Building2 } from 'lucide-react';

function ImageWithFallback(props: any) {
  const [didError, setDidError] = useState(false)
  const { src, alt, style, className, ...rest } = props

  return didError ? (
    <div
      className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
      style={style}
    >
      <div className="flex items-center justify-center w-full h-full">
        <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg==" alt="Error loading image" {...rest} data-original-url={src} />
      </div>
    </div>
  ) : (
    <img src={src} alt={alt} className={className} style={style} {...rest} onError={() => setDidError(true)} />
  )
}

interface UserHeaderProps {
  user: {
    name: string;
    email: string;
    organization: string;
    role: string;
    accountStatus: string;
    accessLevel: string;
    createdDate: string;
    lastActive: string;
    invitedBy?: string;
    avatarUrl: string;
    statusTags: Array<{ label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'premium' }>;
  };
}

export function UserHeader({ user }: UserHeaderProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div className="bg-gradient-to-br from-zinc-800/90 to-zinc-900/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] rounded-[14px] p-6 mb-6">
      <div className="flex items-start justify-between">
        {/* User Info */}
        <div className="flex gap-4">
          <ImageWithFallback
            src={user.avatarUrl}
            alt={user.name}
            className="w-16 h-16 rounded-xl object-cover ring-2 ring-zinc-700/50"
          />
          <div>
            <h2 className="text-xl text-white mb-1">{user.name}</h2>
            <div className="flex items-center gap-3 text-sm text-zinc-400 mb-3">
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                {user.email}
              </span>
              <span className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                {user.organization}
              </span>
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" />
                {user.role}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.statusTags.map((tag, index) => (
                <StatusBadge key={index} label={tag.label} variant={tag.variant} />
              ))}
            </div>
          </div>
        </div>

        {/* Admin Actions */}
        <div className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-700/50 hover:bg-zinc-700 text-white rounded-lg transition-colors"
          >
            Admin Actions
            <ChevronDown className="w-4 h-4" />
          </button>
          
          {showActions && (
            <div className="absolute right-0 mt-2 w-48 bg-zinc-800 rounded-lg shadow-xl border border-zinc-700 overflow-hidden z-10">
              <button className="w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
                View Account
              </button>
              <button className="w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
                Edit Role
              </button>
              <button className="w-full px-4 py-2.5 text-left text-sm text-amber-400 hover:bg-zinc-700 transition-colors">
                Suspend Access
              </button>
              <button className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-zinc-700 transition-colors">
                Revoke Access
              </button>
              <button className="w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
                View Audit History
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Account Details */}
      <div className="mt-4 pt-4 border-t border-zinc-700/50 flex gap-6 text-sm">
        <div>
          <span className="text-zinc-500">Created:</span>
          <span className="text-zinc-300 ml-2">{user.createdDate}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-zinc-500">Last Active:</span>
          <span className="text-zinc-300 ml-2">{user.lastActive}</span>
        </div>
        {user.invitedBy && (
          <div>
            <span className="text-zinc-500">Invited By:</span>
            <span className="text-zinc-300 ml-2">{user.invitedBy}</span>
          </div>
        )}
      </div>
    </div>
  );
}
