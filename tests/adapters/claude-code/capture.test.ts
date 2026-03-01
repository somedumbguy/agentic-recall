import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { handleCapture, extractLastTurn, readTranscript } from "../../../adapters/claude-code/capture.ts";
import type { CaptureHookInput } from "../../../adapters/claude-code/capture.ts";

function makeMockClient() {
  const calls: { content: string; type: string }[] = [];
  return {
    client: {
      query: async () => [],
      store: async (content: string, type: string) => {
        calls.push({ content, type });
        return { id: "stored-1" };
      },
      delete: async () => ({ deleted: true }),
      getProfile: async () => [],
      health: async () => ({ ok: true, memoryCount: 0, dbSize: "0" }),
    } as any,
    calls,
  };
}

let tmpDir: string;
let transcriptPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "capture-test-"));
  transcriptPath = join(tmpDir, "transcript.jsonl");
  delete process.env.AGENTIC_RECALL_AUTO_CAPTURE;
  delete process.env.AGENTIC_RECALL_DUAL_SAVE;
  delete process.env.AGENTIC_RECALL_DEBUG;
});

afterEach(() => {
  try { unlinkSync(transcriptPath); } catch {}
});

function writeTranscript(entries: object[]): void {
  writeFileSync(transcriptPath, entries.map((e) => JSON.stringify(e)).join("\n"));
}

function makeInput(overrides: Partial<CaptureHookInput> = {}): CaptureHookInput {
  return {
    session_id: "test-session",
    transcript_path: transcriptPath,
    permission_mode: "default",
    hook_event_name: "Stop",
    stop_hook_active: false,
    ...overrides,
  };
}

describe("Claude Code capture hook", () => {
  it("exits immediately when stop_hook_active is true", async () => {
    writeTranscript([
      { role: "user", content: "hello world this is a test message" },
      { role: "assistant", content: "This is a response with enough length to pass validation" },
    ]);
    const { client, calls } = makeMockClient();
    await handleCapture(makeInput({ stop_hook_active: true }), client);
    expect(calls).toHaveLength(0);
  });

  it("stores classified fact and raw chunk with dual-save", async () => {
    writeTranscript([
      { role: "user", content: "We decided to use PostgreSQL for ACID compliance in the orders service" },
      { role: "assistant", content: "Good decision. PostgreSQL provides strong ACID compliance for payment processing." },
    ]);
    const { client, calls } = makeMockClient();
    await handleCapture(makeInput(), client);
    // dual-save = 2 calls: extracted fact + raw chunk
    expect(calls).toHaveLength(2);
    // First call: classified fact (not conversation_chunk)
    expect(calls[0]!.type).not.toBe("conversation_chunk");
    // Second call: raw conversation chunk
    expect(calls[1]!.type).toBe("conversation_chunk");
  });

  it("skips capture when autoCapture is disabled", async () => {
    process.env.AGENTIC_RECALL_AUTO_CAPTURE = "false";
    writeTranscript([
      { role: "user", content: "We decided to use PostgreSQL for orders" },
      { role: "assistant", content: "Good choice for ACID compliance in the orders service" },
    ]);
    const { client, calls } = makeMockClient();
    await handleCapture(makeInput(), client);
    expect(calls).toHaveLength(0);
  });

  it("skips capture when transcript has no user+assistant turn", async () => {
    writeTranscript([{ role: "system", content: "You are a helpful assistant" }]);
    const { client, calls } = makeMockClient();
    await handleCapture(makeInput(), client);
    expect(calls).toHaveLength(0);
  });

  it("throws on missing transcript file (caught by main fail-open)", async () => {
    const { client } = makeMockClient();
    await expect(
      handleCapture(makeInput({ transcript_path: "/nonexistent/file.jsonl" }), client),
    ).rejects.toThrow();
  });

  it("strips injected memory blocks before capture", async () => {
    const userWithMemory = "=== RELEVANT MEMORIES (auto-recalled) ===\nOld memory\n=== END MEMORIES ===\n\nSet up database";
    writeTranscript([
      { role: "user", content: userWithMemory },
      { role: "assistant", content: "Setting up PostgreSQL database connection as discussed. Here is the config." },
    ]);
    const { client, calls } = makeMockClient();
    await handleCapture(makeInput(), client);
    expect(calls.length).toBeGreaterThan(0);
    // The stored content should NOT contain the memory block
    expect(calls[0]!.content).not.toContain("=== RELEVANT MEMORIES");
  });
});

describe("extractLastTurn", () => {
  it("extracts last user and assistant messages", () => {
    const transcript = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "second answer" },
    ];
    const turn = extractLastTurn(transcript);
    expect(turn).toEqual({ user: "second question", assistant: "second answer" });
  });

  it("handles content blocks array format", () => {
    const transcript = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "world" }] },
    ];
    const turn = extractLastTurn(transcript);
    expect(turn).toEqual({ user: "hello", assistant: "world" });
  });

  it("handles nested message format", () => {
    const transcript = [
      { message: { role: "user", content: "nested user" } },
      { message: { role: "assistant", content: "nested assistant" } },
    ];
    const turn = extractLastTurn(transcript);
    expect(turn).toEqual({ user: "nested user", assistant: "nested assistant" });
  });

  it("returns null for empty transcript", () => {
    expect(extractLastTurn([])).toBeNull();
  });

  it("returns null when only user messages exist", () => {
    const transcript = [{ role: "user", content: "hello" }];
    expect(extractLastTurn(transcript)).toBeNull();
  });
});

describe("readTranscript", () => {
  it("parses JSONL format", () => {
    writeTranscript([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
    const entries = readTranscript(transcriptPath);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.role).toBe("user");
  });

  it("skips malformed lines", () => {
    writeFileSync(transcriptPath, '{"role":"user","content":"ok"}\nBAD LINE\n{"role":"assistant","content":"yes"}');
    const entries = readTranscript(transcriptPath);
    expect(entries).toHaveLength(2);
  });
});
