import type { OmegaConfig, EventContext, ConversationMessage, ContentBlock } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { sanitizeFull, validateContentLength } from "../lib/validate.ts";
import { classify } from "../lib/classifier.ts";
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
): (ctx: EventContext) => Promise<void> {
  return async (ctx: EventContext): Promise<void> => {
    if (!cfg.autoCapture) return;

    try {
      if (ctx.success === false) {
        log.debug("Skipping capture: agent turn was not successful");
        return;
      }

      const turn = getLastTurn(ctx.messages ?? []);
      if (!turn) {
        log.debug("Skipping capture: no user+assistant turn found");
        return;
      }

      // Sanitize: strip injected context, system prefixes, control chars
      const sanitizedUser = sanitizeFull(turn.user);
      const sanitizedAssistant = sanitizeFull(turn.assistant);
      const combined = `[user]\n${sanitizedUser}\n[/user]\n[assistant]\n${sanitizedAssistant}\n[/assistant]`;

      // Validate length
      const validation = validateContentLength(combined, cfg.captureMinLength, cfg.captureMaxLength);
      if (!validation.valid) {
        log.debug(`Skipping capture: ${validation.reason}`);
        return;
      }

      // Classify
      const classification = classify(sanitizedUser, sanitizedAssistant);
      log.debug(`Classified as: ${classification.type} (confidence: ${classification.confidence})`);

      // In smart mode, only capture if confidence > 0.5
      if (cfg.captureMode === "smart" && classification.confidence <= 0.5) {
        log.debug("Skipping capture: smart mode and low confidence");
        return;
      }

      // Store extracted fact with classified type
      await client.store(classification.extractedFact, classification.type);
      log.debug(`Stored extracted fact as ${classification.type}`);

      // Dual-save: also store raw chunk
      if (cfg.dualSave) {
        await client.store(combined, "conversation_chunk");
        log.debug("Stored raw conversation chunk");
      }
    } catch (err) {
      log.warn("Capture hook error (fail-open):", err instanceof Error ? err.message : String(err));
      // fail-open: never block the agent
    }
  };
}
