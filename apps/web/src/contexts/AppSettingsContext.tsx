import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AppSettings {
  gamificationEnabled: boolean;
}

interface AppSettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  toggleGamification: () => void;
}

const defaultSettings: AppSettings = {
  gamificationEnabled: true,
};

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    // Load from localStorage on initial mount
    const stored = localStorage.getItem('appSettings');
    if (stored) {
      try {
        return { ...defaultSettings, ...JSON.parse(stored) };
      } catch (e) {
        console.error('Failed to parse app settings from localStorage:', e);
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  // Persist to localStorage whenever settings change
  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const toggleGamification = () => {
    setSettings(prev => ({ ...prev, gamificationEnabled: !prev.gamificationEnabled }));
  };

  return (
    <AppSettingsContext.Provider value={{ settings, updateSettings, toggleGamification }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (context === undefined) {
    throw new Error('useAppSettings must be used within an AppSettingsProvider');
  }
  return context;
}
