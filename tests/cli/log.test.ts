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

describe("CLI log", () => {
  let tmpDir: string;
  let logPath: string;
  let consoleSpy: ReturnType<typeof import("@jest/globals").jest.spyOn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ar-test-log-${Date.now()}`);
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
    const { run } = await import("../../cli/log.ts");
    await run([]);
    expect(consoleSpy).toHaveBeenCalledWith("\nNo events in log.");
  });

  it("displays events from log file", async () => {
    const events = [
      makeEvent({ event: "capture_stored", details: { type: "lesson" } }),
      makeEvent({ event: "recall_hit", details: { count: 3 } }),
    ];
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const { run } = await import("../../cli/log.ts");
    await run(["10"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Last 2 events"));
  });
});
