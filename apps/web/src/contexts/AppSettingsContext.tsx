import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AppSettings {
  gamificationEnabled: boolean;
}

interface AppSettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  toggleGamification: () => void;
}

// Gamification is intentionally disabled for now.
// Keep the setting wired for later re-enable, but do not allow it to be turned on yet.
const FORCED_GAMIFICATION_ENABLED = false;

const defaultSettings: AppSettings = {
  gamificationEnabled: FORCED_GAMIFICATION_ENABLED,
};

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    // Load from localStorage on initial mount
    const stored = localStorage.getItem('appSettings');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return { ...defaultSettings, ...parsed, gamificationEnabled: FORCED_GAMIFICATION_ENABLED };
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
    const { gamificationEnabled: _ignored, ...rest } = newSettings;
    setSettings(prev => ({ ...prev, ...rest, gamificationEnabled: FORCED_GAMIFICATION_ENABLED }));
  };

  const toggleGamification = () => {
    // Intentionally no-op until gamification is implemented.
    setSettings(prev => ({ ...prev, gamificationEnabled: FORCED_GAMIFICATION_ENABLED }));
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
