import { buildCaptureHandler } from "../hooks/capture.ts";
import type { OmegaConfig, ConversationMessage } from "../types/index.ts";

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

function makeMessages(user: string, assistant: string): ConversationMessage[] {
  return [
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ];
}

function makeMockClient() {
  const stored: { content: string; type: string }[] = [];
  return {
    client: {
      query: async () => [],
      store: async (content: string, type: string) => { stored.push({ content, type }); return { id: "test" }; },
      delete: async () => ({ deleted: true }),
      getProfile: async () => [],
      health: async () => ({ ok: true, memoryCount: 0, dbSize: "0" }),
    } as any,
    stored,
  };
}

describe("capture hook", () => {
  it("does nothing when autoCapture is disabled", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig({ autoCapture: false }));
    await handler({ messages: makeMessages("test", "response"), success: true });
    expect(stored).toHaveLength(0);
  });

  it("skips when no messages", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    await handler({ messages: [], success: true });
    expect(stored).toHaveLength(0);
  });

  it("skips unsuccessful turns", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    await handler({ messages: makeMessages("test", "response"), success: false });
    expect(stored).toHaveLength(0);
  });

  it("skips content that is too short", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig({ captureMinLength: 100 }));
    await handler({ messages: makeMessages("hi", "yo"), success: true });
    expect(stored).toHaveLength(0);
  });

  it("captures and dual-saves a normal conversation", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    await handler({
      messages: makeMessages(
        "What database should we use?",
        "We chose PostgreSQL for ACID compliance in the payments service.",
      ),
      success: true,
    });
    expect(stored).toHaveLength(2); // extracted fact + raw chunk
    expect(stored[0]!.type).toBe("decision");
    expect(stored[1]!.type).toBe("conversation_chunk");
  });

  it("classifies decisions correctly", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    await handler({
      messages: makeMessages(
        "Which approach?",
        "We decided to use microservices instead of a monolith.",
      ),
      success: true,
    });
    expect(stored[0]!.type).toBe("decision");
  });

  it("classifies error patterns correctly", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    await handler({
      messages: makeMessages(
        "What happened?",
        "Error: ECONNRESET on the API calls. Fixed by setting maxSockets to 50.",
      ),
      success: true,
    });
    expect(stored[0]!.type).toBe("error_pattern");
  });

  it("skips in smart mode when classifier confidence is low", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig({ captureMode: "smart" }));
    await handler({
      messages: makeMessages(
        "Hello, how are you today?",
        "I'm doing well, thanks for asking! How can I help you?",
      ),
      success: true,
    });
    expect(stored).toHaveLength(0); // general = low confidence, smart mode skips
  });

  it("disables dual-save when configured", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig({ dualSave: false }));
    await handler({
      messages: makeMessages(
        "Approach?",
        "We chose Redis for caching because of its low latency.",
      ),
      success: true,
    });
    expect(stored).toHaveLength(1); // Only extracted fact
  });

  it("strips injected memory context before capture", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    const userMsg = `=== RELEVANT MEMORIES (auto-recalled) ===
[old memory]
=== END MEMORIES ===
What database should we use?`;
    await handler({
      messages: makeMessages(userMsg, "Let's go with PostgreSQL for reliability."),
      success: true,
    });
    expect(stored.length).toBeGreaterThan(0);
    // The stored content should NOT contain the memory block markers
    for (const s of stored) {
      expect(s.content).not.toContain("=== RELEVANT MEMORIES");
    }
  });

  it("handles client errors gracefully (fail-open)", async () => {
    const errorClient = {
      query: async () => [],
      store: async () => { throw new Error("storage failed"); },
      delete: async () => ({ deleted: false }),
      getProfile: async () => [],
      health: async () => ({ ok: false, memoryCount: 0, dbSize: "" }),
    } as any;
    const handler = buildCaptureHandler(errorClient, makeConfig());
    // Should not throw
    await handler({
      messages: makeMessages("important decision", "We chose TypeScript for type safety."),
      success: true,
    });
  });

  it("handles array content blocks", async () => {
    const { client, stored } = makeMockClient();
    const handler = buildCaptureHandler(client, makeConfig());
    const messages: ConversationMessage[] = [
      { role: "user", content: [{ type: "text", text: "What should we decide on the framework?" }] },
      { role: "assistant", content: [{ type: "text", text: "We chose Next.js for server-side rendering support." }] },
    ];
    await handler({ messages, success: true });
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0]!.type).toBe("decision");
  });
});
