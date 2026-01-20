import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type UserRole = 'investor' | 'analyst';

interface UserRoleSettings {
  role: UserRole;
}

interface UserRoleContextType {
  settings: UserRoleSettings;
  setRole: (role: UserRole) => void;
  isInvestor: boolean;
  isAnalyst: boolean;
}

const UserRoleContext = createContext<UserRoleContextType | undefined>(undefined);

const STORAGE_KEY = 'dealdecision_user_role';

export function UserRoleProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserRoleSettings>(() => {
    // Try to load from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const roleRaw = (parsed as any)?.role;
        // Backward compat: migrate legacy 'founder' to 'analyst'
        const role: UserRole = roleRaw === 'analyst' ? 'analyst' : roleRaw === 'investor' ? 'investor' : roleRaw === 'founder' ? 'analyst' : 'investor';
        return { role };
      } catch {
        // If parsing fails, use default
      }
    }
    // Default to investor
    return { role: 'investor' };
  });

  // Save to localStorage whenever settings change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setRole = (role: UserRole) => {
    setSettings({ role });
  };

  const value: UserRoleContextType = {
    settings,
    setRole,
    isInvestor: settings.role === 'investor',
    isAnalyst: settings.role === 'analyst',
  };

  return (
    <UserRoleContext.Provider value={value}>
      {children}
    </UserRoleContext.Provider>
  );
}

export function useUserRole() {
  const context = useContext(UserRoleContext);
  if (context === undefined) {
    throw new Error('useUserRole must be used within a UserRoleProvider');
  }
  return context;
}
