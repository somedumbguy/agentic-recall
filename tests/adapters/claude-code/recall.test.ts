import { handleRecall } from "../../../adapters/claude-code/recall.ts";
import type { RecallHookInput } from "../../../adapters/claude-code/recall.ts";
import type { OmegaMemory } from "../../../types/index.ts";

function makeMem(id: string, content: string, score: number): OmegaMemory {
  return {
    id, content, type: "decision", score,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    accessed_count: 3, tags: [],
  };
}

function makeMockClient(memories: OmegaMemory[] = []) {
  return {
    query: async () => memories,
    store: async () => ({ id: "test" }),
    delete: async () => ({ deleted: true }),
    getProfile: async () => [],
    health: async () => ({ ok: true, memoryCount: 0, dbSize: "0" }),
  } as any;
}

function makeInput(overrides: Partial<RecallHookInput> = {}): RecallHookInput {
  return {
    session_id: "test-session",
    transcript_path: "/tmp/test.jsonl",
    cwd: "/tmp",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "What database should we use for orders?",
    ...overrides,
  };
}

describe("Claude Code recall hook", () => {
  beforeEach(() => {
    delete process.env.AGENTIC_RECALL_AUTO_RECALL;
    delete process.env.AGENTIC_RECALL_DEBUG;
  });

  it("returns additionalContext with memories", async () => {
    const mems = [makeMem("1", "We chose PostgreSQL for ACID compliance", 0.87)];
    const result = await handleRecall(makeInput(), makeMockClient(mems));
    expect(result).not.toBeNull();
    expect(result!.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(result!.hookSpecificOutput.additionalContext).toContain("=== RELEVANT MEMORIES (auto-recalled) ===");
    expect(result!.hookSpecificOutput.additionalContext).toContain("PostgreSQL");
    expect(result!.hookSpecificOutput.additionalContext).toContain("=== END MEMORIES ===");
  });

  it("returns null when prompt is too short", async () => {
    const result = await handleRecall(makeInput({ prompt: "hi" }), makeMockClient());
    expect(result).toBeNull();
  });

  it("returns null when prompt is empty", async () => {
    const result = await handleRecall(makeInput({ prompt: "" }), makeMockClient());
    expect(result).toBeNull();
  });

  it("returns null when autoRecall is disabled", async () => {
    process.env.AGENTIC_RECALL_AUTO_RECALL = "false";
    const mems = [makeMem("1", "Some memory", 0.87)];
    const result = await handleRecall(makeInput(), makeMockClient(mems));
    expect(result).toBeNull();
  });

  it("returns null when no memories found", async () => {
    const result = await handleRecall(makeInput(), makeMockClient([]));
    expect(result).toBeNull();
  });

  it("filters memories below minScore", async () => {
    const mems = [makeMem("1", "low score memory", 0.1)];
    const result = await handleRecall(makeInput(), makeMockClient(mems));
    expect(result).toBeNull();
  });

  it("outputs valid JSON structure for Claude Code", async () => {
    const mems = [makeMem("1", "We chose PostgreSQL for ACID compliance", 0.87)];
    const result = await handleRecall(makeInput(), makeMockClient(mems));
    expect(result).toBeDefined();
    const json = JSON.parse(JSON.stringify(result));
    expect(json).toHaveProperty("hookSpecificOutput");
    expect(json.hookSpecificOutput).toHaveProperty("hookEventName");
    expect(json.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("handles client errors gracefully (fail-open)", async () => {
    const errorClient = {
      query: async () => { throw new Error("connection failed"); },
      store: async () => ({ id: "" }),
      delete: async () => ({ deleted: false }),
      getProfile: async () => [],
      health: async () => ({ ok: false, memoryCount: 0, dbSize: "" }),
    } as any;
    await expect(handleRecall(makeInput(), errorClient)).rejects.toThrow();
    // Note: the main() wrapper catches this and exits 0 (fail-open)
  });
});
