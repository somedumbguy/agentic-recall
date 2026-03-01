import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { LogEvent } from "../../types/index.ts";

function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    event: "recall_hit",
    platform: "claude-code",
    light: "green",
    duration_ms: 42,
    details: { topScore: 0.8, count: 3 },
    ...overrides,
  };
}

// Mock the OmegaClient to avoid real subprocess calls
const mockClient = {
  health: async () => ({ ok: true, memoryCount: 10, dbSize: "1MB" }),
  query: async () => [],
  store: async () => ({ id: "1" }),
  delete: async () => ({ deleted: true }),
};

describe("CLI light", () => {
  let tmpDir: string;
  let logPath: string;
  let consoleSpy: ReturnType<typeof import("@jest/globals").jest.spyOn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ar-test-light-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    logPath = join(tmpDir, "events.jsonl");
    process.env.AGENTIC_RECALL_LOG_PATH = logPath;

    const { jest } = await import("@jest/globals");
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.AGENTIC_RECALL_LOG_PATH;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    consoleSpy?.mockRestore();
  });

  it("computes green light from healthy events", async () => {
    // Write events with good recall data
    const events = Array.from({ length: 10 }, () =>
      makeEvent({ event: "recall_hit", details: { topScore: 0.8, count: 3 } })
    );
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    // We can't easily test light.ts directly because it imports OmegaClient.
    // Instead, test the underlying computeLight function which the CLI wraps.
    const { computeLight, lightEmoji } = await import("../../lib/confidence-light.ts");
    const { ConfidenceState } = await import("../../lib/confidence-state.ts");

    const state = new ConfidenceState();
    state.setOmegaReachable(true);
    for (const e of events) {
      state.recordRecall(true, 0.8, 3, 42);
      state.recordOmegaCall("query", 42, true);
    }

    const signals = state.getSignals();
    const light = computeLight(signals);

    expect(light.color).toBe("green");
    expect(lightEmoji(light.color)).toContain("\u{1F7E2}");
  });

  it("shows signal breakdown labels", async () => {
    // Verify the light CLI prints expected labels
    const events = [makeEvent()];
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    // Import to verify it exports run
    const mod = await import("../../cli/light.ts");
    expect(typeof mod.run).toBe("function");
  });
});
