import type { OmegaConfig, OmegaMemory, EventContext, EventResult } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { deduplicateMemories } from "../lib/dedup.ts";
import { formatMemoriesBlock } from "../lib/formatter.ts";
import { log } from "../logger.ts";

let turnCount = 0;

export function buildRecallHandler(
  client: OmegaClient,
  cfg: OmegaConfig,
): (ctx: EventContext) => Promise<EventResult | void> {
  turnCount = 0;

  return async (ctx: EventContext): Promise<EventResult | void> => {
    if (!cfg.autoRecall) return;

    try {
      const prompt = ctx.prompt ?? "";
      if (prompt.length < 5) {
        log.debug("Skipping recall: prompt too short");
        return;
      }

      turnCount++;

      // Query OMEGA for relevant memories
      const memories = await client.query(prompt, {
        limit: cfg.maxRecallResults,
      });

      // Filter by minimum score
      const filtered = memories.filter((m) => m.score >= cfg.recallMinScore);

      if (filtered.length === 0 && turnCount % cfg.profileFrequency !== 0) {
        log.debug("No memories above min score and not a profile turn");
        return;
      }

      // Deduplicate
      const deduped = deduplicateMemories(filtered);

      // Every N turns, include user profile
      let profileMemories: OmegaMemory[] | undefined;
      if (turnCount <= 1 || turnCount % cfg.profileFrequency === 0) {
        profileMemories = await client.getProfile();
        log.debug(`Including profile (turn ${turnCount}), got ${profileMemories.length} profile memories`);
      }

      // Format the block
      const block = formatMemoriesBlock(deduped, profileMemories);
      if (!block) return;

      log.debug(`Injecting ${deduped.length} memories into context`);
      return { prependContext: block };
    } catch (err) {
      log.warn("Recall hook error (fail-open):", err instanceof Error ? err.message : String(err));
      return; // fail-open
    }
  };
}
