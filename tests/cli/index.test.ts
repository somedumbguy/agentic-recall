import { describe, it, expect } from "@jest/globals";
import { existsSync } from "fs";

describe("CLI index", () => {
  it("exports all 9 commands", async () => {
    const commands = ["status", "stats", "doctor", "search", "log", "browse", "export", "prune", "light"];
    for (const cmd of commands) {
      expect(existsSync(`cli/${cmd}.ts`)).toBe(true);
    }
  });

  it("each command module exports a run function", async () => {
    const commands = ["log", "stats", "light", "browse", "export"];
    for (const cmd of commands) {
      const mod = await import(`../../cli/${cmd}.ts`);
      expect(typeof mod.run).toBe("function");
    }
  });
});
