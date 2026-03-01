import type { ConfidenceSignals, ConfidenceLightResult, LightColor } from "../types/index.ts";

/**
 * Compute the confidence light color from system signals.
 * Evaluates QUALITY, not just health — a technically healthy system
 * can still show yellow if memories aren't relevant.
 */
export function computeLight(signals: ConfidenceSignals): ConfidenceLightResult {
  // RED conditions — system is broken
  if (!signals.omegaReachable)
    return { color: "red", reason: "OMEGA unreachable" };
  if (signals.recentErrorCount > 10)
    return { color: "red", reason: `${signals.recentErrorCount} errors in 30min` };
  if (!signals.recallSuccess)
    return { color: "red", reason: "recall query failed" };
  if (signals.lastCaptureAge > 3600 && signals.lastSuccessfulRecall > 3600)
    return { color: "red", reason: "no activity in 1+ hour" };

  // YELLOW conditions — degraded quality
  if (signals.topScore < 0.3 && signals.memoriesFound > 0)
    return { color: "yellow", reason: `low relevance (top: ${signals.topScore.toFixed(2)})` };
  if (signals.memoriesInjected === 0 && signals.consecutiveMisses >= 3)
    return { color: "yellow", reason: `${signals.consecutiveMisses} consecutive misses` };
  if (signals.recentSkipRate > 0.4)
    return { color: "yellow", reason: `high skip rate (${(signals.recentSkipRate * 100).toFixed(0)}%)` };
  if (signals.recentRecallMissRate > 0.6)
    return { color: "yellow", reason: `low hit rate (${((1 - signals.recentRecallMissRate) * 100).toFixed(0)}%)` };
  if (signals.recallLatency > 1000)
    return { color: "yellow", reason: `slow recall (${signals.recallLatency}ms)` };
  if (signals.avgRecentLatency > 500)
    return { color: "yellow", reason: `avg latency elevated (${signals.avgRecentLatency.toFixed(0)}ms)` };
  if (signals.recentErrorCount > 3)
    return { color: "yellow", reason: `${signals.recentErrorCount} recent errors` };

  // GREEN — everything healthy
  return { color: "green", reason: "" };
}

const LIGHT_EMOJI: Record<LightColor, string> = {
  green: "\u{1F7E2}",
  yellow: "\u{1F7E1}",
  red: "\u{1F534}",
};

export function lightEmoji(color: LightColor): string {
  return LIGHT_EMOJI[color];
}
