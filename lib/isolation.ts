import { existsSync, statSync, unlinkSync } from "fs";
import { homedir } from "os";

/**
 * Meta-memory patterns: conversations about the memory system itself.
 * These should NOT be captured as memories (self-pollution).
 */
const META_PATTERNS: RegExp[] = [
  /memory.*(status|health|check|diagnos)/i,
  /agentic.recall.*(stats|doctor|error|broken)/i,
  /why.*(didn't|didn't|not).*(remember|recall|know)/i,
  /what.*(do you|does it).*(remember|know about)/i,
  /how.*(many|much).*(memor|stored|captured)/i,
  /memory.*(system|engine|database|log)/i,
  /\/(memory-check|recall-status|memory-debug)/,
  /confidence.*light|🟢|🟡|🔴/,
  /OMEGA.*(error|unreachable|status|version)/i,
];

/**
 * Layer 1: Check if a conversation is about the memory system itself.
 */
export function isMetaMemoryConversation(userMessage: string, assistantMessage: string): boolean {
  const combined = userMessage + " " + assistantMessage;
  return META_PATTERNS.some((pattern) => pattern.test(combined));
}

/**
 * Layer 2: Diagnostic mode — pauses ALL capture during debugging sessions.
 */
const DIAGNOSTIC_FLAG_PATH = `${homedir()}/.agentic-recall/.diagnostic-mode`;
const DIAGNOSTIC_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour auto-clear

let _diagnosticModeInMemory = false;

export function isDiagnosticMode(): boolean {
  // Check in-memory flag
  if (_diagnosticModeInMemory) return true;

  // Check environment variable
  if (process.env.AGENTIC_RECALL_DIAGNOSTIC === "true") return true;

  // Check file flag (with auto-clear after 1 hour)
  try {
    if (existsSync(DIAGNOSTIC_FLAG_PATH)) {
      const s = statSync(DIAGNOSTIC_FLAG_PATH);
      if (Date.now() - s.mtimeMs > DIAGNOSTIC_MAX_AGE_MS) {
        // Auto-clear stale flag
        try { unlinkSync(DIAGNOSTIC_FLAG_PATH); } catch {}
        return false;
      }
      return true;
    }
  } catch {}

  return false;
}

export function setDiagnosticMode(active: boolean): void {
  _diagnosticModeInMemory = active;
}

/**
 * Layer 3: Extended content stripping — removes all memory system metadata
 * from text before it could be captured.
 */
export function stripMemorySystemContent(text: string): string {
  let cleaned = text;
  // Strip memory injection blocks (multiline)
  cleaned = cleaned.replace(/===\s*RELEVANT MEMORIES.*?===\s*END MEMORIES.*?===/gs, "");
  cleaned = cleaned.replace(/===\s*RECALL SKIPPED.*?===/g, "");
  // Strip confidence indicators (emoji + text)
  cleaned = cleaned.replace(/(?:\u{1F7E2}|\u{1F7E1}|\u{1F534})\s*[\d]+ memories.*$/gmu, "");
  // Strip attribution lines
  cleaned = cleaned.replace(/^Source:.*$/gm, "");
  // Strip system status lines
  cleaned = cleaned.replace(/\[agentic-recall\].*$/gm, "");
  // Strip memory IDs
  cleaned = cleaned.replace(/\| id: mem_\w+/g, "");
  return cleaned.trim();
}

/**
 * Combined isolation check: should we skip capturing this turn?
 * Returns the reason string if capture should be skipped, or null if capture should proceed.
 */
export function shouldSkipCapture(
  userMessage: string,
  assistantMessage: string,
): string | null {
  if (isDiagnosticMode()) return "diagnostic_mode";
  if (isMetaMemoryConversation(userMessage, assistantMessage)) return "meta_memory_conversation";
  return null;
}
