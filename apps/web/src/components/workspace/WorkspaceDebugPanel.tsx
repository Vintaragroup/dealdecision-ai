import { Dialog, DialogContent } from '../ui/dialog';

interface WorkspaceDebugPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  darkMode: boolean;
  children: React.ReactNode;
}

/**
 * Thin Dialog shell for the workspace debug sections (DIO State, API Map,
 * Governed Consistency Warnings, Missing Fields).
 *
 * All debug content is passed as children so those sections can reference
 * DealWorkspace.tsx local variables directly without a large props list.
 */
export function WorkspaceDebugPanel({
  open,
  onOpenChange,
  darkMode,
  children,
}: WorkspaceDebugPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0 ${
          darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div
          className={`px-4 py-3 border-b text-sm font-semibold ${
            darkMode ? 'border-white/10 text-gray-200' : 'border-gray-200 text-gray-800'
          }`}
        >
          Workspace Debug
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
