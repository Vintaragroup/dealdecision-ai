import { BarChart3, FileText, LayoutDashboard, List, Settings2, Users, Wand2, Bell, SunMoon, Sparkles } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from './ui/command';
import type { PageView } from './Sidebar';
import { useScoreSource } from '../contexts/ScoreSourceContext';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (page: PageView) => void;
  onToggleDarkMode: () => void;
  onToggleNotifications: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onToggleDarkMode,
  onToggleNotifications,
}: CommandPaletteProps) {
  const { scoreSource, setScoreSource } = useScoreSource();
  const prefersFundability = scoreSource === 'fundability_v1';

  const closeAnd = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command Palette" description="Search for pages and actions">
      <CommandInput placeholder="Search pages, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => closeAnd(() => onNavigate('dashboard'))}>
            <LayoutDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(() => onNavigate('dealsList'))}>
            <List />
            Deal Pipeline
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(() => onNavigate('documents'))}>
            <FileText />
            Documents
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(() => onNavigate('analytics'))}>
            <BarChart3 />
            Analytics
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(() => onNavigate('aiStudio'))}>
            <Wand2 />
            AI Studio
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Account">
          <CommandItem onSelect={() => closeAnd(() => onNavigate('profile'))}>
            <Sparkles />
            Profile
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(() => onNavigate('team'))}>
            <Users />
            Team
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(() => onNavigate('settings'))}>
            <Settings2 />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => closeAnd(onToggleNotifications)}>
            <Bell />
            Toggle Notifications
          </CommandItem>
          <CommandItem onSelect={() => closeAnd(onToggleDarkMode)}>
            <SunMoon />
            Toggle Theme
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              closeAnd(() => setScoreSource(prefersFundability ? 'legacy' : 'fundability_v1'))
            }
          >
            <Sparkles />
            Switch Score Source
            <CommandShortcut>{prefersFundability ? 'Fundability' : 'Fundamentals'}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
