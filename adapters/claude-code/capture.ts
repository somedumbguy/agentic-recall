#!/usr/bin/env node
/**
 * Claude Code Stop hook — CAPTURE
 *
 * Reads hook JSON from stdin, extracts last turn from transcript,
 * classifies via core classifier, stores via core omega-client.
 * Fail-open: any error → exit 0 silently.
 *
 * CRITICAL: If stop_hook_active is true, exit immediately to prevent infinite loops.
 */
import { readFileSync } from "fs";
import { getConfigFromEnv } from "../../config.ts";
import { OmegaClient } from "../../lib/omega-client.ts";
import { classify } from "../../lib/classifier.ts";
import { sanitizeFull, validateContentLength } from "../../lib/validate.ts";
import { initLogger } from "../../logger.ts";

export interface CaptureHookInput {
  session_id: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: string;
  stop_hook_active: boolean;
}

export interface TranscriptEntry {
  role?: string;
  type?: string;
  content?: string | { type: string; text?: string }[];
  message?: {
    role?: string;
    content?: string | { type: string; text?: string }[];
  };
}

function extractText(content: string | { type: string; text?: string }[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.text)
    .map((b) => b.text!)
    .join("\n");
}

export function readTranscript(path: string): TranscriptEntry[] {
  const content = readFileSync(path, "utf-8");
  return content
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as TranscriptEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is TranscriptEntry => entry !== null);
}

export function extractLastTurn(transcript: TranscriptEntry[]): { user: string; assistant: string } | null {
  let assistant = "";
  let user = "";

  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i]!;
    // Handle both flat format { role, content } and nested { message: { role, content } }
    const role = entry.role ?? entry.message?.role;
    const content = entry.content ?? entry.message?.content;

    if (role === "assistant" && !assistant) {
      assistant = extractText(content);
    }
    if (role === "user" && !user) {
      user = extractText(content);
    }
    if (user && assistant) break;
  }

  if (!user || !assistant) return null;
  return { user, assistant };
}

export async function handleCapture(
  input: CaptureHookInput,
  clientOverride?: OmegaClient,
): Promise<void> {
  // CRITICAL: prevent infinite loops
  if (input.stop_hook_active) return;

  const config = getConfigFromEnv();
  initLogger(undefined, config.debug);

  if (!config.autoCapture) return;

  const transcript = readTranscript(input.transcript_path);
  const turn = extractLastTurn(transcript);
  if (!turn) return;

  // Sanitize: strip injected context, system prefixes, control chars
  const sanitizedUser = sanitizeFull(turn.user);
  const sanitizedAssistant = sanitizeFull(turn.assistant);
  const combined = `[user]\n${sanitizedUser}\n[/user]\n[assistant]\n${sanitizedAssistant}\n[/assistant]`;

  // Validate length
  const validation = validateContentLength(combined, config.captureMinLength, config.captureMaxLength);
  if (!validation.valid) return;

  // Classify
  const classification = classify(sanitizedUser, sanitizedAssistant);

  // In smart mode, only capture if confidence > 0.5
  if (config.captureMode === "smart" && classification.confidence <= 0.5) return;

  const client = clientOverride ?? new OmegaClient(config);

  // Store extracted fact
  await client.store(classification.extractedFact, classification.type);

  // Dual-save: also store raw chunk
  if (config.dualSave) {
    await client.store(combined, "conversation_chunk");
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 5000);
  });
}

async function main(): Promise<void> {
  let input: CaptureHookInput;
  try {
    const stdin = await readStdin();
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  try {
    await handleCapture(input!);
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
