import { formatRelativeTime, formatMemoryEntry, formatMemoriesBlock } from "../lib/formatter.ts";
import type { OmegaMemory } from "../types/index.ts";

function makeMem(overrides: Partial<OmegaMemory> = {}): OmegaMemory {
  return {
    id: "test-1",
    content: "We chose PostgreSQL for ACID compliance.",
    type: "decision",
    score: 0.87,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    accessed_count: 3,
    tags: [],
    ...overrides,
  };
}

describe("formatRelativeTime", () => {
  it("returns 'just now' for very recent times", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5 minutes ago");
  });

  it("returns hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2 hours ago");
  });

  it("returns days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
  });

  it("returns weeks ago", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoWeeksAgo)).toBe("2 weeks ago");
  });

  it("handles singular forms", () => {
    const oneMinAgo = new Date(Date.now() - 61 * 1000).toISOString();
    expect(formatRelativeTime(oneMinAgo)).toBe("1 minute ago");
  });
});

describe("formatMemoryEntry", () => {
  it("includes type badge, time, score, and access count", () => {
    const mem = makeMem();
    const result = formatMemoryEntry(mem);
    expect(result).toContain("[decision |");
    expect(result).toContain("score: 0.87");
    expect(result).toContain("accessed: 3x]");
    expect(result).toContain("We chose PostgreSQL");
  });

  it("formats different memory types", () => {
    const mem = makeMem({ type: "error_pattern", score: 0.79 });
    const result = formatMemoryEntry(mem);
    expect(result).toContain("[error_pattern |");
    expect(result).toContain("score: 0.79");
  });
});

describe("formatMemoriesBlock", () => {
  it("returns empty string for no memories", () => {
    expect(formatMemoriesBlock([])).toBe("");
  });

  it("wraps memories in markers", () => {
    const mems = [makeMem()];
    const result = formatMemoriesBlock(mems);
    expect(result).toContain("=== RELEVANT MEMORIES (auto-recalled) ===");
    expect(result).toContain("=== END MEMORIES ===");
    expect(result).toContain("We chose PostgreSQL");
  });

  it("includes profile section when provided", () => {
    const mems = [makeMem()];
    const profile = [makeMem({ content: "Prefers TypeScript strict mode", type: "user_preference" })];
    const result = formatMemoriesBlock(mems, profile);
    expect(result).toContain("=== USER PROFILE ===");
    expect(result).toContain("- Prefers TypeScript strict mode");
  });

  it("handles profile-only output", () => {
    const profile = [makeMem({ content: "Uses early returns", type: "user_preference" })];
    const result = formatMemoriesBlock([], profile);
    expect(result).toContain("=== USER PROFILE ===");
    expect(result).toContain("- Uses early returns");
  });
});
