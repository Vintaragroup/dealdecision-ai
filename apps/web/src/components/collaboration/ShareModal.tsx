import { useState } from 'react';
import { Button } from '../ui/button';
import {
  Share2,
  Link2,
  Mail,
  Users,
  Copy,
  CheckCircle,
  X,
  Clock,
  Eye,
  Edit3,
  Lock,
  Globe,
  Calendar
} from 'lucide-react';

interface ShareModalProps {
  darkMode: boolean;
  onClose: () => void;
  itemName: string;
  itemType: 'deal' | 'document' | 'report';
}

interface SharedUser {
  id: string;
  name: string;
  email: string;
  role: 'editor' | 'viewer';
  avatar?: string;
}

export function ShareModal({ darkMode, onClose, itemName, itemType }: ShareModalProps) {
  const [shareMethod, setShareMethod] = useState<'people' | 'link'>('people');
  const [emailInput, setEmailInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<'editor' | 'viewer'>('viewer');
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkSettings, setLinkSettings] = useState({
    access: 'restricted',
    permission: 'viewer',
    expiry: 'never'
  });

  // Mock shared users
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([
    {
      id: '1',
      name: 'Michael Rodriguez',
      email: 'michael@dealdecision.ai',
      role: 'editor'
    },
    {
      id: '2',
      name: 'Emily Watson',
      email: 'emily@venture.capital',
      role: 'viewer'
    }
  ]);

  const handleAddPerson = () => {
    if (!emailInput) return;
    
    const newUser: SharedUser = {
      id: Math.random().toString(36).substr(2, 9),
      name: emailInput.split('@')[0],
      email: emailInput,
      role: selectedRole
    };
    
    setSharedUsers([...sharedUsers, newUser]);
    setEmailInput('');
  };

  const handleCopyLink = () => {
    const link = `https://dealdecision.ai/shared/${itemType}/${Math.random().toString(36).substr(2, 9)}`;
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleRemoveUser = (userId: string) => {
    setSharedUsers(sharedUsers.filter(u => u.id !== userId));
  };

  const handleChangeRole = (userId: string, newRole: 'editor' | 'viewer') => {
    setSharedUsers(sharedUsers.map(u => 
      u.id === userId ? { ...u, role: newRole } : u
    ));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl shadow-2xl ${
        darkMode ? 'bg-[#18181b]' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
                <Share2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className={`text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Share {itemType}
                </h2>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {itemName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
          </div>

          {/* Method Tabs */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setShareMethod('people')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all ${
                shareMethod === 'people'
                  ? darkMode
                    ? 'bg-[#6366f1]/20 border border-[#6366f1] text-[#6366f1]'
                    : 'bg-[#6366f1]/10 border border-[#6366f1] text-[#6366f1]'
                  : darkMode
                    ? 'bg-white/5 border border-white/10 text-gray-400'
                    : 'bg-gray-50 border border-gray-200 text-gray-600'
              }`}
            >
              <Users className="w-4 h-4 inline-block mr-2" />
              Share with People
            </button>
            <button
              onClick={() => setShareMethod('link')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all ${
                shareMethod === 'link'
                  ? darkMode
                    ? 'bg-[#6366f1]/20 border border-[#6366f1] text-[#6366f1]'
                    : 'bg-[#6366f1]/10 border border-[#6366f1] text-[#6366f1]'
                  : darkMode
                    ? 'bg-white/5 border border-white/10 text-gray-400'
                    : 'bg-gray-50 border border-gray-200 text-gray-600'
              }`}
            >
              <Link2 className="w-4 h-4 inline-block mr-2" />
              Get Link
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(85vh-180px)]">
          {shareMethod === 'people' ? (
            <div className="space-y-6">
              {/* Add People */}
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Add people
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`} />
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddPerson()}
                      placeholder="Enter email address"
                      className={`w-full h-10 pl-10 pr-4 rounded-lg border ${
                        darkMode
                          ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                          : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                      }`}
                    />
                  </div>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as any)}
                    className={`h-10 px-3 rounded-lg border text-sm ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="viewer">Can view</option>
                    <option value="editor">Can edit</option>
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    darkMode={darkMode}
                    onClick={handleAddPerson}
                    disabled={!emailInput}
                  >
                    Add
                  </Button>
                </div>
              </div>

              {/* People with Access */}
              <div>
                <h3 className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  People with access ({sharedUsers.length})
                </h3>
                <div className="space-y-2">
                  {sharedUsers.map(user => (
                    <div
                      key={user.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        darkMode
                          ? 'bg-white/5 border-white/10'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm ${
                          darkMode ? 'bg-[#6366f1]/20 text-[#6366f1]' : 'bg-[#6366f1]/10 text-[#6366f1]'
                        }`}>
                          {user.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <div className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {user.name}
                          </div>
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {user.email}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={user.role}
                          onChange={(e) => handleChangeRole(user.id, e.target.value as any)}
                          className={`h-8 px-2 rounded-lg border text-xs ${
                            darkMode
                              ? 'bg-white/5 border-white/10 text-white'
                              : 'bg-white border-gray-200 text-gray-900'
                          }`}
                        >
                          <option value="viewer">Can view</option>
                          <option value="editor">Can edit</option>
                        </select>
                        <button
                          onClick={() => handleRemoveUser(user.id)}
                          className={`p-2 rounded-lg transition-colors ${
                            darkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-600'
                          }`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {sharedUsers.length === 0 && (
                    <div className={`text-center py-8 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No one has access yet</p>
                      <p className="text-xs mt-1">Add people above to share</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Permission Info */}
              <div className={`p-4 rounded-lg border ${
                darkMode ? 'bg-[#6366f1]/5 border-[#6366f1]/20' : 'bg-[#6366f1]/5 border-[#6366f1]/20'
              }`}>
                <div className="flex gap-3">
                  <Lock className="w-5 h-5 text-[#6366f1] flex-shrink-0" />
                  <div>
                    <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Permission Levels
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      • <strong>Can edit:</strong> Make changes, comment, and share
                      <br />
                      • <strong>Can view:</strong> View and comment only
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Link Access */}
              <div>
                <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Link Access
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'restricted', label: 'Restricted', desc: 'Only people with access', icon: Lock },
                    { value: 'anyone', label: 'Anyone with link', desc: 'Anyone on the internet', icon: Globe }
                  ].map(option => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setLinkSettings({ ...linkSettings, access: option.value })}
                        className={`w-full p-3 rounded-lg border text-left transition-all ${
                          linkSettings.access === option.value
                            ? darkMode
                              ? 'bg-[#6366f1]/20 border-[#6366f1]'
                              : 'bg-[#6366f1]/10 border-[#6366f1]'
                            : darkMode
                              ? 'bg-white/5 border-white/10 hover:border-white/20'
                              : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className={`w-5 h-5 ${
                            linkSettings.access === option.value ? 'text-[#6366f1]' : darkMode ? 'text-gray-400' : 'text-gray-600'
                          }`} />
                          <div className="flex-1">
                            <div className={`text-sm mb-0.5 ${
                              linkSettings.access === option.value 
                                ? 'text-[#6366f1]' 
                                : darkMode ? 'text-white' : 'text-gray-900'
                            }`}>
                              {option.label}
                            </div>
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                              {option.desc}
                            </div>
                          </div>
                          {linkSettings.access === option.value && (
                            <CheckCircle className="w-5 h-5 text-[#6366f1]" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Link Permission */}
              {linkSettings.access === 'anyone' && (
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Permission
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'viewer', label: 'Viewer', icon: Eye },
                      { value: 'editor', label: 'Editor', icon: Edit3 }
                    ].map(option => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.value}
                          onClick={() => setLinkSettings({ ...linkSettings, permission: option.value })}
                          className={`p-3 rounded-lg border transition-all ${
                            linkSettings.permission === option.value
                              ? darkMode
                                ? 'bg-[#6366f1]/20 border-[#6366f1]'
                                : 'bg-[#6366f1]/10 border-[#6366f1]'
                              : darkMode
                                ? 'bg-white/5 border-white/10 hover:border-white/20'
                                : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <Icon className={`w-5 h-5 mb-1 ${
                            linkSettings.permission === option.value ? 'text-[#6366f1]' : darkMode ? 'text-gray-400' : 'text-gray-600'
                          }`} />
                          <div className={`text-sm ${
                            linkSettings.permission === option.value 
                              ? 'text-[#6366f1]' 
                              : darkMode ? 'text-white' : 'text-gray-900'
                          }`}>
                            {option.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Link Expiry */}
              {linkSettings.access === 'anyone' && (
                <div>
                  <label className={`block text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Link Expiration
                  </label>
                  <select
                    value={linkSettings.expiry}
                    onChange={(e) => setLinkSettings({ ...linkSettings, expiry: e.target.value })}
                    className={`w-full h-10 px-3 rounded-lg border ${
                      darkMode
                        ? 'bg-white/5 border-white/10 text-white'
                        : 'bg-white border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="never">Never expires</option>
                    <option value="1day">1 day</option>
                    <option value="7days">7 days</option>
                    <option value="30days">30 days</option>
                  </select>
                </div>
              )}

              {/* Copy Link Button */}
              <div className={`p-4 rounded-lg border ${
                darkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center gap-3">
                  <Link2 className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                  <div className="flex-1">
                    <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      Share Link
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      https://dealdecision.ai/shared/...
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    darkMode={darkMode}
                    onClick={handleCopyLink}
                    icon={linkCopied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  >
                    {linkCopied ? 'Copied!' : 'Copy Link'}
                  </Button>
                </div>
              </div>

              {/* Warning */}
              {linkSettings.access === 'anyone' && (
                <div className={`p-4 rounded-lg border ${
                  darkMode ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-50 border-amber-200'
                }`}>
                  <div className="flex gap-3">
                    <Globe className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    <div>
                      <div className={`text-sm mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Public Link Warning
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Anyone with this link can {linkSettings.permission === 'editor' ? 'edit' : 'view'} this {itemType}. 
                        Consider using restricted access for sensitive information.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t flex items-center justify-between ${
          darkMode ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            {shareMethod === 'people' 
              ? `${sharedUsers.length} people have access`
              : `Link: ${linkSettings.access === 'restricted' ? 'Restricted' : 'Public'}`
            }
          </div>
          <Button
            variant="primary"
            size="sm"
            darkMode={darkMode}
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
