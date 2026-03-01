import { appendFile, stat, rename } from "fs/promises";
import { homedir } from "os";
import { dirname } from "path";
import { mkdir } from "fs/promises";
import type { LogEvent, EventType, LightColor, Platform } from "../types/index.ts";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATIONS = 2;
const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_SIZE = 10;
const PREVIEW_LENGTH = 100;

function truncatePreview(text: unknown): unknown {
  if (typeof text === "string" && text.length > PREVIEW_LENGTH) {
    return text.slice(0, PREVIEW_LENGTH) + "...";
  }
  return text;
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    safe[key] = truncatePreview(value);
  }
  return safe;
}

export class EventLogger {
  private logPath: string;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disabled: boolean = false;
  private warnedOnce: boolean = false;
  private _initialized: boolean = false;

  constructor(logPath?: string) {
    this.logPath =
      logPath ??
      process.env.AGENTIC_RECALL_LOG_PATH ??
      `${homedir()}/.agentic-recall/events.jsonl`;
  }

  getLogPath(): string {
    return this.logPath;
  }

  async log(
    event: EventType,
    sessionId: string,
    platform: Platform,
    durationMs: number,
    light: LightColor,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    if (this.disabled) return;

    const entry: LogEvent = {
      timestamp: new Date().toISOString(),
      event,
      session_id: sessionId,
      platform,
      duration_ms: durationMs,
      light,
      details: sanitizeDetails(details),
    };

    this.buffer.push(JSON.stringify(entry));

    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush().catch(() => {});
      }, FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.disabled || this.buffer.length === 0) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const lines = this.buffer.splice(0);
    const data = lines.join("\n") + "\n";

    try {
      if (!this._initialized) {
        await mkdir(dirname(this.logPath), { recursive: true });
        this._initialized = true;
      }
      await this.rotateIfNeeded();
      await appendFile(this.logPath, data, "utf-8");
    } catch (err) {
      if (!this.warnedOnce) {
        console.error(`[agentic-recall] Event log unavailable: ${err instanceof Error ? err.message : String(err)}`);
        this.warnedOnce = true;
      }
      this.disabled = true;
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const s = await stat(this.logPath);
      if (s.size < MAX_FILE_SIZE) return;
    } catch {
      return; // file doesn't exist yet
    }

    // Rotate: .1 -> .2 (delete if exists), current -> .1
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const from = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
      const to = `${this.logPath}.${i}`;
      try {
        await rename(from, to);
      } catch {
        // source doesn't exist, skip
      }
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/** Singleton for the default event logger */
let _defaultLogger: EventLogger | null = null;

export function getEventLogger(logPath?: string): EventLogger {
  if (!_defaultLogger) {
    _defaultLogger = new EventLogger(logPath);
  }
  return _defaultLogger;
}

export function resetEventLogger(): void {
  _defaultLogger = null;
}
