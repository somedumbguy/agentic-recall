import { buildRecallHandler } from "../hooks/recall.ts";
import type { OmegaConfig, OmegaMemory } from "../types/index.ts";

function makeConfig(overrides: Partial<OmegaConfig> = {}): OmegaConfig {
  return {
    omegaPath: "omega", pythonPath: "python3", dbPath: "", connectionMode: "cli",
    udsSocketPath: "", autoRecall: true, maxRecallResults: 10, profileFrequency: 50,
    recallMinScore: 0.3, autoCapture: true, captureMode: "all", captureMinLength: 20,
    captureMaxLength: 50000, dualSave: true, containerTag: "test", enableCustomContainerTags: false,
    customContainers: [], customContainerInstructions: "", debug: false,
    ...overrides,
  };
}

function makeMem(id: string, content: string, score: number): OmegaMemory {
  return {
    id, content, type: "decision", score,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    accessed_count: 1, tags: [],
  };
}

function makeMockClient(memories: OmegaMemory[] = [], profile: OmegaMemory[] = []) {
  return {
    query: async (_text: string, _opts?: { type?: string; limit?: number }) => memories,
    store: async () => ({ id: "test" }),
    delete: async () => ({ deleted: true }),
    getProfile: async () => profile,
    health: async () => ({ ok: true, memoryCount: 0, dbSize: "0" }),
  } as any;
}

describe("recall hook", () => {
  it("returns nothing when autoRecall is disabled", async () => {
    const handler = buildRecallHandler(makeMockClient(), makeConfig({ autoRecall: false }));
    const result = await handler({ prompt: "test prompt" });
    expect(result).toBeUndefined();
  });

  it("skips when prompt is too short", async () => {
    const handler = buildRecallHandler(makeMockClient(), makeConfig());
    const result = await handler({ prompt: "hi" });
    expect(result).toBeUndefined();
  });

  it("returns nothing when no memories match", async () => {
    const handler = buildRecallHandler(makeMockClient([]), makeConfig());
    const result = await handler({ prompt: "What database should we use?" });
    expect(result).toBeUndefined();
  });

  it("injects formatted memories into context", async () => {
    const mems = [makeMem("1", "We chose PostgreSQL for ACID compliance", 0.87)];
    const handler = buildRecallHandler(makeMockClient(mems), makeConfig());
    const result = await handler({ prompt: "What database are we using?" });
    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("=== RELEVANT MEMORIES (auto-recalled) ===");
    expect(result!.prependContext).toContain("PostgreSQL");
    expect(result!.prependContext).toContain("=== END MEMORIES ===");
  });

  it("filters out memories below minScore", async () => {
    const mems = [makeMem("1", "low score memory", 0.1)];
    const handler = buildRecallHandler(makeMockClient(mems), makeConfig({ recallMinScore: 0.3 }));
    const result = await handler({ prompt: "What should I do?" });
    expect(result).toBeUndefined();
  });

  it("includes profile on first turn", async () => {
    const mems = [makeMem("1", "Some memory", 0.8)];
    const profile = [makeMem("p1", "Prefers TypeScript", 0.9)];
    const handler = buildRecallHandler(makeMockClient(mems, profile), makeConfig());
    const result = await handler({ prompt: "Hello, help me with code" });
    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("=== USER PROFILE ===");
    expect(result!.prependContext).toContain("Prefers TypeScript");
  });

  it("handles client errors gracefully (fail-open)", async () => {
    const errorClient = {
      query: async () => { throw new Error("connection failed"); },
      store: async () => ({ id: "" }),
      delete: async () => ({ deleted: false }),
      getProfile: async () => [],
      health: async () => ({ ok: false, memoryCount: 0, dbSize: "" }),
    } as any;
    const handler = buildRecallHandler(errorClient, makeConfig());
    const result = await handler({ prompt: "test prompt that should not crash" });
    expect(result).toBeUndefined(); // fail-open: no crash
  });
});
