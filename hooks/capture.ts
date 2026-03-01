import type { OmegaConfig, EventContext, ConversationMessage, ContentBlock } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { sanitizeFull, validateContentLength } from "../lib/validate.ts";
import { classify } from "../lib/classifier.ts";
import { shouldSkipCapture, stripMemorySystemContent } from "../lib/isolation.ts";
import { ConfidenceState } from "../lib/confidence-state.ts";
import { computeLight } from "../lib/confidence-light.ts";
import { getEventLogger } from "../lib/event-log.ts";
import { log } from "../logger.ts";

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function getLastTurn(messages: ConversationMessage[]): { user: string; assistant: string } | null {
  if (!messages || messages.length === 0) return null;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return null;

  const userText = extractText(messages[lastUserIdx]!.content);
  const assistantParts: string[] = [];
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i]!.role === "assistant") {
      assistantParts.push(extractText(messages[i]!.content));
    }
  }

  if (assistantParts.length === 0) return null;
  return { user: userText, assistant: assistantParts.join("\n") };
}

export function buildCaptureHandler(
  client: OmegaClient,
  cfg: OmegaConfig,
  getSessionKey?: () => string | undefined,
  confidenceState?: ConfidenceState,
): (ctx: EventContext) => Promise<void> {
  const state = confidenceState ?? new ConfidenceState();
  const eventLogger = getEventLogger();

  return async (ctx: EventContext): Promise<void> => {
    if (!cfg.autoCapture) return;

    try {
      const sessionId = getSessionKey?.() ?? "";

      if (ctx.success === false) {
        log.debug("Skipping capture: agent turn was not successful");
        return;
      }

      const turn = getLastTurn(ctx.messages ?? []);
      if (!turn) {
        log.debug("Skipping capture: no user+assistant turn found");
        return;
      }

      const startTime = Date.now();

      // Isolation check (meta-memory patterns + diagnostic mode)
      const skipReason = shouldSkipCapture(turn.user, turn.assistant);
      if (skipReason) {
        state.recordCapture(false, true, skipReason);
        await eventLogger.log("capture_skipped", sessionId, "openclaw", Date.now() - startTime, "green", {
          reason: skipReason,
        });
        await eventLogger.flush();
        log.debug(`Skipping capture: ${skipReason}`);
        return;
      }

      // Layer 3: Strip memory system content + sanitize
      const strippedUser = stripMemorySystemContent(turn.user);
      const strippedAssistant = stripMemorySystemContent(turn.assistant);
      const sanitizedUser = sanitizeFull(strippedUser);
      const sanitizedAssistant = sanitizeFull(strippedAssistant);
      const combined = `[user]\n${sanitizedUser}\n[/user]\n[assistant]\n${sanitizedAssistant}\n[/assistant]`;

      // Validate length
      const validation = validateContentLength(combined, cfg.captureMinLength, cfg.captureMaxLength);
      if (!validation.valid) {
        state.recordCapture(false, true, "validation");
        await eventLogger.log("capture_skipped", sessionId, "openclaw", Date.now() - startTime, "green", {
          reason: combined.length < cfg.captureMinLength ? "too_short" : "too_long",
        });
        await eventLogger.flush();
        log.debug(`Skipping capture: ${validation.reason}`);
        return;
      }

      // Classify
      const classification = classify(sanitizedUser, sanitizedAssistant);
      log.debug(`Classified as: ${classification.type} (confidence: ${classification.confidence})`);

      // In smart mode, only capture if confidence > 0.5
      if (cfg.captureMode === "smart" && classification.confidence <= 0.5) {
        state.recordCapture(false, true, "low_confidence");
        await eventLogger.log("capture_skipped", sessionId, "openclaw", Date.now() - startTime, "green", {
          reason: "low_confidence",
        });
        await eventLogger.flush();
        log.debug("Skipping capture: smart mode and low confidence");
        return;
      }

      // Store extracted fact with classified type
      const storeStart = Date.now();
      await client.store(classification.extractedFact, classification.type);
      state.recordOmegaCall("store", Date.now() - storeStart, true);
      log.debug(`Stored extracted fact as ${classification.type}`);

      // Dual-save: also store raw chunk
      if (cfg.dualSave) {
        const dualStart = Date.now();
        await client.store(combined, "conversation_chunk");
        state.recordOmegaCall("store", Date.now() - dualStart, true);
        log.debug("Stored raw conversation chunk");
      }

      state.recordCapture(true, false, classification.type);

      const totalMs = Date.now() - startTime;
      const signals = state.getSignals();
      const light = computeLight(signals);

      await eventLogger.log("capture_stored", sessionId, "openclaw", totalMs, light.color, {
        type: classification.type, confidence: classification.confidence, dual_save: cfg.dualSave,
      });
      await eventLogger.flush();
    } catch (err) {
      log.warn("Capture hook error (fail-open):", err instanceof Error ? err.message : String(err));
      // fail-open: never block the agent
    }
  };
}
