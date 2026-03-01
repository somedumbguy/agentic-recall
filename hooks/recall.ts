import type { OmegaConfig, OmegaMemory, EventContext, EventResult } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { deduplicateMemories } from "../lib/dedup.ts";
import { formatMemoriesBlock } from "../lib/formatter.ts";
import { computeLight } from "../lib/confidence-light.ts";
import { ConfidenceState } from "../lib/confidence-state.ts";
import { SelfChecker } from "../lib/self-check.ts";
import { getEventLogger } from "../lib/event-log.ts";
import { log } from "../logger.ts";

let turnCount = 0;

export function buildRecallHandler(
  client: OmegaClient,
  cfg: OmegaConfig,
  confidenceState?: ConfidenceState,
): (ctx: EventContext) => Promise<EventResult | void> {
  turnCount = 0;
  const state = confidenceState ?? new ConfidenceState();
  const eventLogger = getEventLogger();
  const selfChecker = new SelfChecker({
    getSignals: () => state.getSignals(),
    omegaHealth: async () => (await client.health()).ok,
  });

  return async (ctx: EventContext): Promise<EventResult | void> => {
    if (!cfg.autoRecall) return;

    try {
      const prompt = ctx.prompt ?? "";
      if (prompt.length < 5) {
        log.debug("Skipping recall: prompt too short");
        return;
      }

      turnCount++;

      const startTime = Date.now();
      let recallSuccess = true;
      let memories: OmegaMemory[] = [];

      // Query OMEGA for relevant memories
      try {
        memories = await client.query(prompt, { limit: cfg.maxRecallResults });
        state.recordOmegaCall("query", Date.now() - startTime, true);
      } catch (err) {
        recallSuccess = false;
        state.recordOmegaCall("query", Date.now() - startTime, false);
        state.recordError();
        throw err;
      }

      const latency = Date.now() - startTime;

      // Filter by minimum score
      const filtered = memories.filter((m) => m.score >= cfg.recallMinScore);

      if (filtered.length === 0 && turnCount % cfg.profileFrequency !== 0) {
        state.recordRecall(false, 0, 0, latency);

        const signals = state.getSignals({
          success: recallSuccess, found: memories.length, injected: 0,
          topScore: 0, avgScore: 0, latency,
        });
        const light = computeLight(signals);

        await eventLogger.log("recall_miss", ctx.sessionKey ?? "", "openclaw", latency, light.color, {
          prompt: prompt.slice(0, 100), light_reason: light.reason,
        });
        await eventLogger.flush();

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

      const hit = deduped.length > 0;
      const topScore = deduped.length > 0 ? Math.max(...deduped.map((m) => m.score)) : 0;
      const avgScore = deduped.length > 0 ? deduped.reduce((s, m) => s + m.score, 0) / deduped.length : 0;

      state.recordRecall(hit, topScore, deduped.length, latency);

      const signals = state.getSignals({
        success: recallSuccess, found: memories.length, injected: deduped.length,
        topScore, avgScore, latency,
      });
      const light = computeLight(signals);

      await eventLogger.log(
        hit ? "recall_hit" : "recall_miss",
        ctx.sessionKey ?? "", "openclaw", latency, light.color,
        { count: deduped.length, topScore, prompt: prompt.slice(0, 100), light_reason: light.reason },
      );

      // Self-check
      const checkResult = await selfChecker.checkIfDue();
      if (checkResult) {
        await eventLogger.log("self_check", ctx.sessionKey ?? "", "openclaw", 0, checkResult.overall, {
          checks: checkResult.checks, recommendations: checkResult.recommendations, triggered_by: "turns",
        });
      }

      await eventLogger.flush();

      // Format the block with confidence light footer
      const block = formatMemoriesBlock(deduped, profileMemories, {
        light, count: deduped.length, latencyMs: latency,
      });
      if (!block) return;

      log.debug(`Injecting ${deduped.length} memories into context`);
      return { prependContext: block };
    } catch (err) {
      log.warn("Recall hook error (fail-open):", err instanceof Error ? err.message : String(err));
      return; // fail-open
    }
  };
}
