import type { OmegaMemory, LightColor, ConfidenceLightResult } from "../types/index.ts";
import { lightEmoji } from "./confidence-light.ts";

/**
 * Format a timestamp into a human-readable relative time string.
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * Format a single memory entry for display (with attribution).
 */
export function formatMemoryEntry(memory: OmegaMemory): string {
  const relTime = formatRelativeTime(memory.created_at);
  const score = memory.score.toFixed(2);
  const accessed = memory.accessed_count;
  return `[${memory.type} | ${relTime} | score: ${score} | accessed: ${accessed}x | id: ${memory.id}]\n${memory.content}`;
}

export interface FooterOptions {
  light?: ConfidenceLightResult;
  count?: number;
  latencyMs?: number;
}

/**
 * Format an array of memories into a context injection block.
 * Includes attribution IDs on each memory and confidence light in footer.
 */
export function formatMemoriesBlock(
  memories: OmegaMemory[],
  profileMemories?: OmegaMemory[],
  footer?: FooterOptions,
): string {
  if (memories.length === 0 && (!profileMemories || profileMemories.length === 0) && !footer?.light) {
    return "";
  }

  const parts: string[] = [];

  if (memories.length > 0 || (profileMemories && profileMemories.length > 0)) {
    parts.push("=== RELEVANT MEMORIES (auto-recalled) ===");
    parts.push("");

    for (const mem of memories) {
      parts.push(formatMemoryEntry(mem));
      parts.push("");
    }

    if (profileMemories && profileMemories.length > 0) {
      parts.push("=== USER PROFILE ===");
      for (const mem of profileMemories) {
        parts.push(`- ${mem.content}`);
      }
      parts.push("");
    }
  }

  // Footer with confidence light
  if (footer?.light) {
    const emoji = lightEmoji(footer.light.color);
    const count = footer.count ?? memories.length;
    const latency = footer.latencyMs != null ? `, ${footer.latencyMs}ms` : "";
    const reason = footer.light.reason ? ` ${footer.light.reason}` : "";

    if (footer.light.color === "red" && memories.length === 0) {
      parts.push(`=== RECALL SKIPPED | ${emoji} ${footer.light.reason} ===`);
    } else {
      parts.push(`=== END MEMORIES | ${emoji} ${count} memories${latency}${reason ? " —" + reason : ""} ===`);
    }
  } else {
    parts.push("=== END MEMORIES ===");
  }

  return parts.join("\n");
}
