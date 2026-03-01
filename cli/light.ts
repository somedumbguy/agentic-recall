import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";
import { computeLight, lightEmoji } from "../lib/confidence-light.ts";
import { ConfidenceState } from "../lib/confidence-state.ts";
import { readAllEvents } from "./utils.ts";
import type { LightColor } from "../types/index.ts";

export async function run(_args: string[]): Promise<void> {
  const config = getConfigFromEnv();
  const client = new OmegaClient(config);
  const health = await client.health();

  // Build a confidence state from recent event log data
  const state = new ConfidenceState();
  state.setOmegaReachable(health.ok);

  const events = await readAllEvents();
  const recent = events.slice(-50);

  for (const e of recent) {
    if (e.event === "recall_hit") {
      state.recordRecall(true, Number(e.details.topScore ?? 0), Number(e.details.count ?? 0), e.duration_ms);
      state.recordOmegaCall("query", e.duration_ms, true);
    } else if (e.event === "recall_miss") {
      state.recordRecall(false, 0, 0, e.duration_ms);
      state.recordOmegaCall("query", e.duration_ms, true);
    } else if (e.event === "capture_stored") {
      state.recordCapture(true, false, String(e.details.type ?? "general"));
      state.recordOmegaCall("store", e.duration_ms, true);
    } else if (e.event === "capture_skipped") {
      state.recordCapture(false, true, String(e.details.reason ?? "unknown"));
    } else if (e.event === "recall_error" || e.event === "omega_error") {
      state.recordError();
      state.recordOmegaCall("query", e.duration_ms, false);
    }
  }

  const signals = state.getSignals();
  const light = computeLight(signals);

  console.log(`\nCurrent: ${lightEmoji(light.color)} (${light.color}${light.reason ? " — " + light.reason : ""})\n`);

  console.log("Signal breakdown:");
  console.log(`  OMEGA reachable:      ${signals.omegaReachable ? "\u2705" : "\u274C"}`);
  console.log(`  Consecutive misses:   ${signals.consecutiveMisses}`);
  console.log(`  Skip rate:            ${(signals.recentSkipRate * 100).toFixed(0)}% (threshold: 40%)`);
  console.log(`  Hit rate:             ${((1 - signals.recentRecallMissRate) * 100).toFixed(0)}% (threshold: 40%)`);
  console.log(`  Avg latency:          ${signals.avgRecentLatency.toFixed(0)}ms (threshold: 500ms)`);
  console.log(`  Recent errors:        ${signals.recentErrorCount} (threshold: 5)`);

  // History from event log
  const recallEvents = recent.filter((e) => e.event === "recall_hit" || e.event === "recall_miss");
  if (recallEvents.length > 0) {
    const history = recallEvents.slice(-20).map((e) => lightEmoji(e.light)).join("");
    console.log(`\nHistory (last ${Math.min(recallEvents.length, 20)} turns):`);
    console.log(`  ${history}`);
  }

  console.log("\nThresholds:");
  console.log("  green -> yellow:  top_score < 0.3, skip_rate > 40%, hit_rate < 40%, latency > 500ms, errors > 3");
  console.log("  yellow -> red:    OMEGA unreachable, errors > 10, recall query failed");
  console.log();
}
