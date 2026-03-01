#!/usr/bin/env node
/**
 * Claude Code Stop hook — CAPTURE
 *
 * Reads hook JSON from stdin, extracts last turn from transcript,
 * classifies via core classifier, stores via core omega-client.
 * Includes 3-layer isolation, confidence state tracking, and event logging.
 * Fail-open: any error → exit 0 silently.
 *
 * CRITICAL: If stop_hook_active is true, exit immediately to prevent infinite loops.
 */
import { readFileSync } from "fs";
import { getConfigFromEnv } from "../../config.ts";
import { OmegaClient } from "../../lib/omega-client.ts";
import { classify } from "../../lib/classifier.ts";
import { sanitizeFull, validateContentLength } from "../../lib/validate.ts";
import { shouldSkipCapture, stripMemorySystemContent } from "../../lib/isolation.ts";
import { ConfidenceState } from "../../lib/confidence-state.ts";
import { computeLight, lightEmoji } from "../../lib/confidence-light.ts";
import { getEventLogger } from "../../lib/event-log.ts";
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

// Module-level singleton (shares state with recall hook if same process)
let _confidenceState: ConfidenceState | null = null;

function getConfidenceState(): ConfidenceState {
  if (!_confidenceState) _confidenceState = new ConfidenceState();
  return _confidenceState;
}

export async function handleCapture(
  input: CaptureHookInput,
  clientOverride?: OmegaClient,
  confidenceStateOverride?: ConfidenceState,
): Promise<void> {
  // CRITICAL: prevent infinite loops
  if (input.stop_hook_active) return;

  const config = getConfigFromEnv();
  initLogger(undefined, config.debug);
  const eventLogger = getEventLogger();
  const confidenceState = confidenceStateOverride ?? getConfidenceState();

  if (!config.autoCapture) {
    await eventLogger.log("capture_skipped", input.session_id, "claude-code", 0, "green", {
      reason: "auto_capture_disabled",
    });
    return;
  }

  const startTime = Date.now();
  const transcript = readTranscript(input.transcript_path);
  const turn = extractLastTurn(transcript);
  if (!turn) {
    await eventLogger.log("capture_skipped", input.session_id, "claude-code", 0, "green", {
      reason: "empty",
    });
    return;
  }

  // Layer 1+2: Isolation check (meta-memory patterns + diagnostic mode)
  const skipReason = shouldSkipCapture(turn.user, turn.assistant);
  if (skipReason) {
    confidenceState.recordCapture(false, true, skipReason);
    await eventLogger.log("capture_skipped", input.session_id, "claude-code", Date.now() - startTime, "green", {
      reason: skipReason,
    });
    console.error(`[agentic-recall] skipped: ${skipReason}`);
    await eventLogger.flush();
    return;
  }

  // Layer 3: Strip memory system content + sanitize
  const strippedUser = stripMemorySystemContent(turn.user);
  const strippedAssistant = stripMemorySystemContent(turn.assistant);
  const sanitizedUser = sanitizeFull(strippedUser);
  const sanitizedAssistant = sanitizeFull(strippedAssistant);
  const combined = `[user]\n${sanitizedUser}\n[/user]\n[assistant]\n${sanitizedAssistant}\n[/assistant]`;

  // Validate length
  const validation = validateContentLength(combined, config.captureMinLength, config.captureMaxLength);
  if (!validation.valid) {
    confidenceState.recordCapture(false, true, "validation");
    await eventLogger.log("capture_skipped", input.session_id, "claude-code", Date.now() - startTime, "green", {
      reason: combined.length < config.captureMinLength ? "too_short" : "too_long",
    });
    await eventLogger.flush();
    return;
  }

  // Classify
  const classification = classify(sanitizedUser, sanitizedAssistant);

  await eventLogger.log("capture_classified", input.session_id, "claude-code", Date.now() - startTime, "green", {
    type: classification.type,
    confidence: classification.confidence,
  });

  // In smart mode, only capture if confidence > 0.5
  if (config.captureMode === "smart" && classification.confidence <= 0.5) {
    confidenceState.recordCapture(false, true, "low_confidence");
    await eventLogger.log("capture_skipped", input.session_id, "claude-code", Date.now() - startTime, "green", {
      reason: "low_confidence",
    });
    await eventLogger.flush();
    return;
  }

  const client = clientOverride ?? new OmegaClient(config);

  // Store extracted fact
  const storeStart = Date.now();
  await client.store(classification.extractedFact, classification.type);
  confidenceState.recordOmegaCall("store", Date.now() - storeStart, true);

  // Dual-save: also store raw chunk
  if (config.dualSave) {
    const dualStart = Date.now();
    await client.store(combined, "conversation_chunk");
    confidenceState.recordOmegaCall("store", Date.now() - dualStart, true);
  }

  confidenceState.recordCapture(true, false, classification.type);

  const totalMs = Date.now() - startTime;

  // Compute light for logging
  const signals = confidenceState.getSignals();
  const light = computeLight(signals);
  const emoji = lightEmoji(light.color);

  await eventLogger.log("capture_stored", input.session_id, "claude-code", totalMs, light.color, {
    type: classification.type,
    confidence: classification.confidence,
    dual_save: config.dualSave,
  });

  console.error(`[agentic-recall] captured: ${classification.type} (${classification.confidence.toFixed(2)}) ${emoji} ${totalMs}ms`);
  await eventLogger.flush();
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
