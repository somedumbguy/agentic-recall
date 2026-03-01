import { jest } from "@jest/globals";
import { mkdtempSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventLogger } from "../lib/event-log.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "eventlog-test-"));
});

describe("EventLogger", () => {
  it("writes events in JSONL format", async () => {
    const logPath = join(tmpDir, "events.jsonl");
    const logger = new EventLogger(logPath);
    await logger.log("recall_hit", "sess1", "claude-code", 150, "green", { count: 3 });
    await logger.flush();
    const content = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(content);
    expect(entry.event).toBe("recall_hit");
    expect(entry.session_id).toBe("sess1");
    expect(entry.platform).toBe("claude-code");
    expect(entry.duration_ms).toBe(150);
    expect(entry.light).toBe("green");
    expect(entry.details.count).toBe(3);
    expect(entry.timestamp).toBeDefined();
  });

  it("truncates long detail strings for privacy", async () => {
    const logPath = join(tmpDir, "events.jsonl");
    const logger = new EventLogger(logPath);
    const longStr = "x".repeat(200);
    await logger.log("capture_stored", "sess1", "openclaw", 100, "green", { content: longStr });
    await logger.flush();
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect((entry.details.content as string).length).toBeLessThan(110);
    expect((entry.details.content as string).endsWith("...")).toBe(true);
  });

  it("batches writes and flushes", async () => {
    const logPath = join(tmpDir, "events.jsonl");
    const logger = new EventLogger(logPath);
    for (let i = 0; i < 5; i++) {
      await logger.log("omega_call", "sess1", "claude-code", i * 10, "green", {});
    }
    await logger.flush();
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(5);
  });

  it("rotates when file exceeds max size", async () => {
    const logPath = join(tmpDir, "events.jsonl");
    // Write 11MB to guarantee exceeding 10MB threshold
    const chunk = "x".repeat(1024) + "\n";
    const fd = openSync(logPath, "w");
    for (let i = 0; i < 11 * 1024; i++) {
      writeSync(fd, chunk);
    }
    closeSync(fd);

    const logger = new EventLogger(logPath);
    await logger.log("recall_hit", "sess1", "claude-code", 100, "green", {});
    await logger.flush();

    expect(existsSync(`${logPath}.1`)).toBe(true);
  });

  it("degrades gracefully on unwritable path", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const logger = new EventLogger("/nonexistent/deeply/nested/path/events.jsonl");
    // Should not throw
    await logger.log("recall_hit", "sess1", "claude-code", 100, "green", {});
    await logger.flush();
    errorSpy.mockRestore();
  });

  it("close flushes remaining buffer", async () => {
    const logPath = join(tmpDir, "events.jsonl");
    const logger = new EventLogger(logPath);
    await logger.log("recall_hit", "sess1", "claude-code", 100, "green", {});
    await logger.close();
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });
});
