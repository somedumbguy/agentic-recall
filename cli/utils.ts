import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import type { LogEvent } from "../types/index.ts";

export function getLogPath(): string {
  return process.env.AGENTIC_RECALL_LOG_PATH ?? `${homedir()}/.agentic-recall/events.jsonl`;
}

export async function readLastEvents(count: number): Promise<LogEvent[]> {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const events: LogEvent[] = [];

    // Read from end
    for (let i = lines.length - 1; i >= 0 && events.length < count; i--) {
      try {
        events.push(JSON.parse(lines[i]!) as LogEvent);
      } catch {
        // skip malformed
      }
    }

    return events;
  } catch {
    return [];
  }
}

export async function readAllEvents(): Promise<LogEvent[]> {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as LogEvent; } catch { return null; }
      })
      .filter((e): e is LogEvent => e !== null);
  } catch {
    return [];
  }
}

export function formatAge(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
