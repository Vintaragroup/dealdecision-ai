import type { ExtractedEntity } from "./types";

/**
 * If a JS NER library is available in the repo, Prompt 1 allows using it.
 * For now (Prompt 1 skeleton), return an empty list and keep implementation deterministic.
 */
export function extractEntities(_normalized_text: string): ExtractedEntity[] {
  // TODO(Prompt 7): implement heuristics v1 or integrate an available NER library.
  return [];
}
