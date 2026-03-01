import { deduplicateMemories } from "../lib/dedup.ts";
import type { OmegaMemory } from "../types/index.ts";

function makeMem(id: string, content: string, score: number): OmegaMemory {
  return {
    id,
    content,
    type: "general",
    score,
    created_at: "2025-01-01T00:00:00Z",
    accessed_count: 1,
    tags: [],
  };
}

describe("deduplicateMemories", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicateMemories([])).toEqual([]);
  });

  it("returns single memory unchanged", () => {
    const mems = [makeMem("1", "hello world", 0.9)];
    expect(deduplicateMemories(mems)).toEqual(mems);
  });

  it("removes near-duplicate keeping higher score", () => {
    const mems = [
      makeMem("1", "We chose PostgreSQL for the database", 0.8),
      makeMem("2", "We chose PostgreSQL for the database", 0.9),
    ];
    const result = deduplicateMemories(mems);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2"); // Higher score kept
  });

  it("preserves distinct memories", () => {
    const mems = [
      makeMem("1", "We chose PostgreSQL for the database", 0.8),
      makeMem("2", "Always use early returns in functions", 0.7),
    ];
    const result = deduplicateMemories(mems);
    expect(result).toHaveLength(2);
  });

  it("handles multiple duplicates in chain", () => {
    const mems = [
      makeMem("1", "the fix was to increase the connection pool size to fifty", 0.9),
      makeMem("2", "the fix was to increase the connection pool size to fifty connections", 0.85),
      makeMem("3", "something completely different about auth tokens and sessions", 0.7),
    ];
    const result = deduplicateMemories(mems);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toContain("1");
    expect(result.map((m) => m.id)).toContain("3");
  });

  it("preserves original order", () => {
    const mems = [
      makeMem("1", "first unique memory about auth", 0.7),
      makeMem("2", "second unique memory about caching", 0.8),
      makeMem("3", "third unique memory about testing", 0.6),
    ];
    const result = deduplicateMemories(mems);
    expect(result.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("uses custom threshold", () => {
    const mems = [
      makeMem("1", "use postgres for the db", 0.8),
      makeMem("2", "use postgres for the database", 0.7),
    ];
    // With low threshold, they are duplicates
    const strict = deduplicateMemories(mems, 0.5);
    expect(strict).toHaveLength(1);
    // With high threshold, they are kept
    const loose = deduplicateMemories(mems, 0.99);
    expect(loose).toHaveLength(2);
  });
});
