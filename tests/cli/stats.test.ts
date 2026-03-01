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
    details: {},
    ...overrides,
  };
}

describe("CLI stats", () => {
  let tmpDir: string;
  let logPath: string;
  let consoleSpy: ReturnType<typeof import("@jest/globals").jest.spyOn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ar-test-stats-${Date.now()}`);
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

  it("shows 'no events' when log is empty", async () => {
    const { run } = await import("../../cli/stats.ts");
    await run([]);
    expect(consoleSpy).toHaveBeenCalledWith("\nNo events in the last 7 days.");
  });

  it("computes light distribution", async () => {
    const events = [
      makeEvent({ light: "green" }),
      makeEvent({ light: "green" }),
      makeEvent({ light: "yellow" }),
    ];
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const { run } = await import("../../cli/stats.ts");
    await run([]);

    const calls = consoleSpy.mock.calls.flat().join("\n");
    expect(calls).toContain("CONFIDENCE LIGHT");
    expect(calls).toContain("67%");  // 2/3 green
    expect(calls).toContain("33%");  // 1/3 yellow
  });

  it("shows capture and recall stats", async () => {
    const events = [
      makeEvent({ event: "capture_stored", details: { type: "lesson" } }),
      makeEvent({ event: "capture_skipped", details: { reason: "duplicate" } }),
      makeEvent({ event: "recall_hit", details: { count: 3 } }),
      makeEvent({ event: "recall_miss", details: {} }),
    ];
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const { run } = await import("../../cli/stats.ts");
    await run([]);

    const calls = consoleSpy.mock.calls.flat().join("\n");
    expect(calls).toContain("1 stored");
    expect(calls).toContain("1 skipped");
    expect(calls).toContain("50%");  // 1/2 hit rate
  });
});
