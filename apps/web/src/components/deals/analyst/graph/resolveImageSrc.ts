export function resolveImageSrc(imageUri: string | null): string | null {
  if (!imageUri) return null;
  const trimmed = imageUri.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/')) {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
    return `${apiBase}${trimmed}`;
  }
  return null;
}
