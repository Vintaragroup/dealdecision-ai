import { Documents } from './Documents';

interface DocumentsPageProps {
  darkMode: boolean;
}

export function DocumentsPage({ darkMode }: DocumentsPageProps) {
  return (
    <Documents darkMode={darkMode} />
  );
}