import type { OmegaMemory } from "../types/index.ts";

/**
 * Calculate word overlap ratio between two strings.
 * Returns 0.0-1.0 where 1.0 = identical word sets.
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate memories by removing entries with >threshold content overlap.
 * Keeps the higher-scored memory when two overlap.
 * Preserves original order of surviving memories.
 */
export function deduplicateMemories(
  memories: OmegaMemory[],
  threshold: number = 0.9,
): OmegaMemory[] {
  if (memories.length <= 1) return memories;

  // Sort by score descending so we keep higher-scored ones
  const sorted = [...memories].sort((a, b) => b.score - a.score);
  const removed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (removed.has(j)) continue;
      const overlap = wordOverlap(sorted[i]!.content, sorted[j]!.content);
      if (overlap >= threshold) {
        removed.add(j); // Remove the lower-scored duplicate
      }
    }
  }

  // Return in original order, filtering removed ones
  const keptIds = new Set(
    sorted.filter((_, i) => !removed.has(i)).map((m) => m.id),
  );

  return memories.filter((m) => keptIds.has(m.id));
}
