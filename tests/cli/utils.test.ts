import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { formatAge, readLastEvents, readAllEvents } from "../../cli/utils.ts";
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

describe("formatAge", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(formatAge(new Date().toISOString())).toBe("just now");
  });

  it("returns minutes for timestamps within an hour", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatAge(tenMinAgo)).toBe("10m ago");
  });

  it("returns hours for timestamps within a day", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatAge(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days for older timestamps", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(twoDaysAgo)).toBe("2d ago");
  });
});

describe("readLastEvents / readAllEvents", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ar-test-cli-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    logPath = join(tmpDir, "events.jsonl");
    process.env.AGENTIC_RECALL_LOG_PATH = logPath;
  });

  afterEach(() => {
    delete process.env.AGENTIC_RECALL_LOG_PATH;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("returns empty when log file does not exist", async () => {
    const events = await readLastEvents(10);
    expect(events).toEqual([]);
  });

  it("reads last N events from log", async () => {
    const events = [
      makeEvent({ event: "capture_stored" }),
      makeEvent({ event: "recall_hit" }),
      makeEvent({ event: "recall_miss" }),
    ];
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const result = await readLastEvents(2);
    expect(result).toHaveLength(2);
    // readLastEvents returns newest first
    expect(result[0]!.event).toBe("recall_miss");
    expect(result[1]!.event).toBe("recall_hit");
  });

  it("reads all events from log", async () => {
    const events = [
      makeEvent({ event: "capture_stored" }),
      makeEvent({ event: "recall_hit" }),
    ];
    writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const result = await readAllEvents();
    expect(result).toHaveLength(2);
    expect(result[0]!.event).toBe("capture_stored");
  });

  it("skips malformed lines", async () => {
    const content = JSON.stringify(makeEvent()) + "\n" + "not json\n" + JSON.stringify(makeEvent({ event: "recall_miss" })) + "\n";
    writeFileSync(logPath, content);

    const result = await readAllEvents();
    expect(result).toHaveLength(2);
  });
});
