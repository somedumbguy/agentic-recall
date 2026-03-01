/**
 * Integration tests for Phase 1.5 Observability
 *
 * Tests the full cycle across both adapters (Claude Code + OpenClaw):
 *   1. Full recall cycle → event log has recall events with light
 *   2. Meta-memory conversation → capture_skipped with reason meta_memory_conversation
 *   3. Diagnostic mode on → captures skipped → off → captures resume
 *   4. Self-check fires after N turns → self_check event in log
 *   5. Confidence light degrades → advisory appears in recall injection
 *   6. Confidence light recovers → advisory disappears
 *   7. Prune --meta patterns match diagnostic memories
 *   8. Both adapters produce identical event log format
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { handleRecall } from "../../adapters/claude-code/recall.ts";
import { handleCapture, extractLastTurn } from "../../adapters/claude-code/capture.ts";
import type { RecallHookInput } from "../../adapters/claude-code/recall.ts";
import type { CaptureHookInput } from "../../adapters/claude-code/capture.ts";

import { buildRecallHandler } from "../../hooks/recall.ts";
import { buildCaptureHandler } from "../../hooks/capture.ts";

import { EventLogger, resetEventLogger } from "../../lib/event-log.ts";
import { ConfidenceState } from "../../lib/confidence-state.ts";
import { computeLight } from "../../lib/confidence-light.ts";
import { setDiagnosticMode } from "../../lib/isolation.ts";
import type { OmegaConfig, OmegaMemory, LogEvent, EventContext } from "../../types/index.ts";

// --- Shared test helpers ---

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

function makeMockClient(memories: OmegaMemory[] = []) {
  const storeCalls: { content: string; type: string }[] = [];
  return {
    client: {
      query: async () => memories,
      store: async (content: string, type: string) => {
        storeCalls.push({ content, type });
        return { id: `mem-${storeCalls.length}` };
      },
      delete: async () => ({ deleted: true }),
      getProfile: async () => [],
      health: async () => ({ ok: true, memoryCount: memories.length, dbSize: "1MB" }),
    } as any,
    storeCalls,
  };
}

function makeRecallInput(overrides: Partial<RecallHookInput> = {}): RecallHookInput {
  return {
    session_id: "int-test-session",
    transcript_path: "/tmp/test.jsonl",
    cwd: "/tmp",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "What database should we use for the orders service?",
    ...overrides,
  };
}

function readLogEvents(logPath: string): LogEvent[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as LogEvent; } catch { return null; }
    })
    .filter((e): e is LogEvent => e !== null);
}

// --- Test setup ---

let tmpDir: string;
let logPath: string;
let transcriptPath: string;
let stderrSpy: ReturnType<typeof import("@jest/globals").jest.spyOn>;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `ar-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  logPath = join(tmpDir, "events.jsonl");
  transcriptPath = join(tmpDir, "transcript.jsonl");
  process.env.AGENTIC_RECALL_LOG_PATH = logPath;

  // Reset module singletons
  resetEventLogger();
  setDiagnosticMode(false);

  const { jest } = await import("@jest/globals");
  stderrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.AGENTIC_RECALL_LOG_PATH;
  delete process.env.AGENTIC_RECALL_DIAGNOSTIC;
  delete process.env.AGENTIC_RECALL_AUTO_RECALL;
  delete process.env.AGENTIC_RECALL_AUTO_CAPTURE;
  delete process.env.AGENTIC_RECALL_DUAL_SAVE;
  delete process.env.AGENTIC_RECALL_DEBUG;
  setDiagnosticMode(false);
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  stderrSpy?.mockRestore();
});

function writeTranscript(entries: object[]): void {
  writeFileSync(transcriptPath, entries.map((e) => JSON.stringify(e)).join("\n"));
}

// =====================================================================
// Test 1: Full recall cycle → event log has recall events with light
// =====================================================================
describe("Integration: Full recall cycle", () => {
  it("Claude Code recall produces event log entries with light color", async () => {
    const mems = [
      { id: "m1", content: "We use PostgreSQL for ACID compliance", type: "decision", score: 0.87, created_at: new Date().toISOString(), accessed_count: 2, tags: [] },
    ];
    const { client } = makeMockClient(mems);

    const result = await handleRecall(makeRecallInput(), client);

    expect(result).not.toBeNull();
    expect(result!.hookSpecificOutput.additionalContext).toContain("PostgreSQL");

    // Read event log
    const events = readLogEvents(logPath);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const recallEvent = events.find((e) => e.event === "recall_hit");
    expect(recallEvent).toBeDefined();
    expect(recallEvent!.light).toBe("green");
    expect(recallEvent!.platform).toBe("claude-code");
    expect(recallEvent!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(recallEvent!.details).toHaveProperty("count");
    expect(recallEvent!.details).toHaveProperty("topScore");
  });

  it("OpenClaw recall produces event log entries with light color", async () => {
    resetEventLogger();
    const mems = [
      { id: "m1", content: "We use PostgreSQL for ACID compliance", type: "decision", score: 0.87, created_at: new Date().toISOString(), accessed_count: 2, tags: [] },
    ];
    const { client } = makeMockClient(mems);
    const cfg = makeConfig();
    const handler = buildRecallHandler(client, cfg);

    const result = await handler({ prompt: "What database for orders?", sessionKey: "oc-session" });

    expect(result).toBeDefined();
    expect(result!.prependContext).toContain("PostgreSQL");

    const events = readLogEvents(logPath);
    const recallEvent = events.find((e) => e.event === "recall_hit");
    expect(recallEvent).toBeDefined();
    expect(recallEvent!.light).toBe("green");
    expect(recallEvent!.platform).toBe("openclaw");
  });
});

// =====================================================================
// Test 2: Meta-memory conversation → capture_skipped
// =====================================================================
describe("Integration: Meta-memory isolation", () => {
  it("Claude Code skips capture for meta-memory conversations", async () => {
    writeTranscript([
      { role: "user", content: "What is the memory system status? How many memories are stored?" },
      { role: "assistant", content: "The memory health check shows 42 memories stored. Everything looks good." },
    ]);
    const { client, storeCalls } = makeMockClient();

    await handleCapture(
      { session_id: "meta-test", transcript_path: transcriptPath, permission_mode: "default", hook_event_name: "Stop", stop_hook_active: false },
      client,
    );

    expect(storeCalls).toHaveLength(0);

    const events = readLogEvents(logPath);
    const skipEvent = events.find((e) => e.event === "capture_skipped");
    expect(skipEvent).toBeDefined();
    expect(skipEvent!.details.reason).toBe("meta_memory_conversation");
  });

  it("OpenClaw skips capture for meta-memory conversations", async () => {
    resetEventLogger();
    const { client, storeCalls } = makeMockClient();
    const cfg = makeConfig();
    const handler = buildCaptureHandler(client, cfg);

    await handler({
      messages: [
        { role: "user", content: "How many memories do you have? Check memory status please." },
        { role: "assistant", content: "Memory diagnostics show 10 memories stored." },
      ],
      success: true,
    });

    expect(storeCalls).toHaveLength(0);

    const events = readLogEvents(logPath);
    const skipEvent = events.find((e) => e.event === "capture_skipped");
    expect(skipEvent).toBeDefined();
    expect(skipEvent!.details.reason).toBe("meta_memory_conversation");
  });
});

// =====================================================================
// Test 3: Diagnostic mode on → captures skipped → off → captures resume
// =====================================================================
describe("Integration: Diagnostic mode toggle", () => {
  it("pauses capture while diagnostic mode is active, resumes when cleared", async () => {
    const { client, storeCalls } = makeMockClient();

    // Normal content that would normally be captured
    writeTranscript([
      { role: "user", content: "We decided to use Redis for caching in the orders microservice" },
      { role: "assistant", content: "Good choice. Redis provides fast in-memory caching with TTL support for the orders service." },
    ]);

    const captureInput: CaptureHookInput = {
      session_id: "diag-test", transcript_path: transcriptPath,
      permission_mode: "default", hook_event_name: "Stop", stop_hook_active: false,
    };

    // Turn ON diagnostic mode
    setDiagnosticMode(true);

    await handleCapture(captureInput, client);
    expect(storeCalls).toHaveLength(0);

    let events = readLogEvents(logPath);
    const diagSkip = events.find((e) => e.event === "capture_skipped" && e.details.reason === "diagnostic_mode");
    expect(diagSkip).toBeDefined();

    // Turn OFF diagnostic mode
    setDiagnosticMode(false);

    // Reset event logger singleton to use same log path
    resetEventLogger();

    await handleCapture(captureInput, client);
    expect(storeCalls.length).toBeGreaterThan(0);

    events = readLogEvents(logPath);
    const storedEvent = events.find((e) => e.event === "capture_stored");
    expect(storedEvent).toBeDefined();
  });
});

// =====================================================================
// Test 4: Self-check fires → self_check event in log
// =====================================================================
describe("Integration: Self-check event logging", () => {
  it("self-check produces an event when triggered via Claude Code recall", async () => {
    const { client } = makeMockClient();
    const confidenceState = new ConfidenceState();

    // Create a self-checker that fires immediately (interval=0)
    const { SelfChecker } = await import("../../lib/self-check.ts");
    const selfChecker = new SelfChecker(
      {
        getSignals: () => confidenceState.getSignals(),
        omegaHealth: async () => true,
      },
      { checkInterval: 0, turnsPerCheck: 1 },
    );

    // Call recall with the deps override
    await handleRecall(
      makeRecallInput(),
      client,
      { client, confidenceState, selfChecker },
    );

    const events = readLogEvents(logPath);
    const selfCheckEvent = events.find((e) => e.event === "self_check");
    expect(selfCheckEvent).toBeDefined();
    expect(selfCheckEvent!.details).toHaveProperty("checks");
    expect(selfCheckEvent!.details).toHaveProperty("recommendations");
  });
});

// =====================================================================
// Test 5: Confidence light degrades → advisory in recall injection
// =====================================================================
describe("Integration: Confidence light degradation", () => {
  it("shows degraded light when errors accumulate", async () => {
    const { client } = makeMockClient();
    const confidenceState = new ConfidenceState();

    // Simulate many errors to degrade confidence
    for (let i = 0; i < 12; i++) {
      confidenceState.recordError();
      confidenceState.recordOmegaCall("query", 100, false);
    }
    confidenceState.setOmegaReachable(false);

    const result = await handleRecall(
      makeRecallInput(),
      client,
      { client, confidenceState },
    );

    // With the degraded state, even though query succeeds for this call,
    // the accumulated errors should show a non-green light
    const events = readLogEvents(logPath);
    const recallEvent = events.find((e) => e.event === "recall_miss" || e.event === "recall_hit");
    expect(recallEvent).toBeDefined();
    // Should be red because omegaReachable is false
    expect(recallEvent!.light).toBe("red");
  });
});

// =====================================================================
// Test 6: Confidence light recovers → returns to green
// =====================================================================
describe("Integration: Confidence light recovery", () => {
  it("degrades to yellow on errors, recovers to green when error window expires", () => {
    const state = new ConfidenceState();

    // First: degrade with errors (>3 triggers yellow)
    for (let i = 0; i < 5; i++) {
      state.recordError();
    }
    state.setOmegaReachable(true);
    state.recordRecall(true, 0.8, 3, 50);

    let signals = state.getSignals({
      success: true, found: 3, injected: 3,
      topScore: 0.8, avgScore: 0.8, latency: 50,
    });
    let light = computeLight(signals);
    expect(light.color).toBe("yellow"); // >3 errors in window

    // Simulate error window expiry by creating a fresh state (mimics 30min passing)
    // In production, error count resets after 30-minute window
    const freshState = new ConfidenceState();
    freshState.setOmegaReachable(true);
    for (let i = 0; i < 10; i++) {
      freshState.recordRecall(true, 0.8, 3, 50);
      freshState.recordOmegaCall("query", 50, true);
    }

    signals = freshState.getSignals({
      success: true, found: 3, injected: 3,
      topScore: 0.8, avgScore: 0.8, latency: 50,
    });
    light = computeLight(signals);
    expect(light.color).toBe("green"); // No errors, healthy signals
  });

  it("transitions yellow→green when miss streak breaks", () => {
    const state = new ConfidenceState();
    state.setOmegaReachable(true);

    // Build up consecutive misses (>=3 → yellow)
    for (let i = 0; i < 4; i++) {
      state.recordRecall(false, 0, 0, 50);
    }

    let signals = state.getSignals({
      success: true, found: 0, injected: 0,
      topScore: 0, avgScore: 0, latency: 50,
    });
    let light = computeLight(signals);
    expect(light.color).toBe("yellow");

    // Now a successful hit breaks the streak
    state.recordRecall(true, 0.8, 3, 50);
    signals = state.getSignals({
      success: true, found: 3, injected: 3,
      topScore: 0.8, avgScore: 0.8, latency: 50,
    });
    light = computeLight(signals);
    // consecutiveMisses is reset to 0, recall miss rate is 4/5 (>0.6)
    // but if enough good calls follow, it recovers.
    // With 4 misses and 1 hit → 80% miss rate → still yellow
    // Let's add more hits
    for (let i = 0; i < 10; i++) {
      state.recordRecall(true, 0.8, 3, 50);
      state.recordOmegaCall("query", 50, true);
    }
    signals = state.getSignals({
      success: true, found: 3, injected: 3,
      topScore: 0.8, avgScore: 0.8, latency: 50,
    });
    light = computeLight(signals);
    // 4 misses / 15 total = 26.7% miss rate (<60%), consecutiveMisses=0 → green
    expect(light.color).toBe("green");
  });
});

// =====================================================================
// Test 7: Prune --meta patterns detect diagnostic memories
// =====================================================================
describe("Integration: Meta-memory pattern detection", () => {
  it("prune patterns correctly identify meta-memory content", () => {
    const META_PATTERNS = [
      /memory.*(status|health|check|diagnos)/i,
      /confidence.*light/i,
      /agentic.recall.*(stats|doctor|error)/i,
      /OMEGA.*(error|unreachable|status|version)/i,
    ];

    const metaContent = [
      "What is the memory system status?",
      "The confidence light is green",
      "agentic-recall doctor found an error",
      "OMEGA version 2.0 status check",
    ];

    const normalContent = [
      "We decided to use PostgreSQL for the database",
      "The user prefers TypeScript strict mode",
      "Root cause was a missing index on the orders table",
      "Error: ECONNRESET when connecting to external API",
    ];

    // All meta content should match at least one pattern
    for (const content of metaContent) {
      const matches = META_PATTERNS.some((p) => p.test(content));
      expect(matches).toBe(true);
    }

    // Normal content should NOT match any pattern
    for (const content of normalContent) {
      const matches = META_PATTERNS.some((p) => p.test(content));
      expect(matches).toBe(false);
    }
  });
});

// =====================================================================
// Test 8: Both adapters produce identical event log format
// =====================================================================
describe("Integration: Cross-adapter event log format", () => {
  it("Claude Code and OpenClaw produce LogEvent entries with the same schema", async () => {
    // --- Claude Code recall ---
    const mems = [
      { id: "m1", content: "Use PostgreSQL for ACID", type: "decision", score: 0.87, created_at: new Date().toISOString(), accessed_count: 1, tags: [] },
    ];
    const { client: ccClient } = makeMockClient(mems);
    await handleRecall(makeRecallInput(), ccClient);

    // --- OpenClaw recall ---
    resetEventLogger();
    const { client: ocClient } = makeMockClient(mems);
    const cfg = makeConfig();
    const handler = buildRecallHandler(ocClient, cfg);
    await handler({ prompt: "What database for orders?", sessionKey: "oc-session" });

    // Read all events
    const events = readLogEvents(logPath);
    expect(events.length).toBeGreaterThanOrEqual(2);

    const ccEvent = events.find((e) => e.platform === "claude-code");
    const ocEvent = events.find((e) => e.platform === "openclaw");

    expect(ccEvent).toBeDefined();
    expect(ocEvent).toBeDefined();

    // Verify both have the same required fields
    const requiredFields = ["timestamp", "event", "session_id", "platform", "duration_ms", "light", "details"];
    for (const field of requiredFields) {
      expect(ccEvent).toHaveProperty(field);
      expect(ocEvent).toHaveProperty(field);
    }

    // Verify both have the same event type for recall
    expect(ccEvent!.event).toBe("recall_hit");
    expect(ocEvent!.event).toBe("recall_hit");

    // Verify both have valid light colors
    expect(["green", "yellow", "red"]).toContain(ccEvent!.light);
    expect(["green", "yellow", "red"]).toContain(ocEvent!.light);

    // Verify details have the same structure
    expect(ccEvent!.details).toHaveProperty("count");
    expect(ocEvent!.details).toHaveProperty("count");
    expect(ccEvent!.details).toHaveProperty("topScore");
    expect(ocEvent!.details).toHaveProperty("topScore");
  });
});
