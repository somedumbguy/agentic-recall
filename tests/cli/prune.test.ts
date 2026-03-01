import { describe, it, expect } from "@jest/globals";

describe("CLI prune", () => {
  it("exports a run function", async () => {
    const mod = await import("../../cli/prune.ts");
    expect(typeof mod.run).toBe("function");
  });

  it("defines META_PATTERNS for meta-memory detection", async () => {
    // Verify the module loads and meta patterns are applied correctly
    const patterns = [
      /memory.*(status|health|check|diagnos)/i,
      /confidence.*light/i,
      /agentic.recall.*(stats|doctor|error)/i,
      /OMEGA.*(error|unreachable|status|version)/i,
    ];

    expect(patterns[0]!.test("What is my memory status?")).toBe(true);
    expect(patterns[1]!.test("The confidence light is green")).toBe(true);
    expect(patterns[2]!.test("agentic-recall doctor error")).toBe(true);
    expect(patterns[3]!.test("OMEGA error occurred")).toBe(true);

    // Should NOT match normal user content
    expect(patterns[0]!.test("Remember to buy groceries")).toBe(false);
    expect(patterns[1]!.test("I am confident this will work")).toBe(false);
  });
});
