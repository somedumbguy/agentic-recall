import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";
import { lightEmoji } from "../lib/confidence-light.ts";
import { readLastEvents } from "./utils.ts";

export async function run(_args: string[]): Promise<void> {
  const config = getConfigFromEnv();
  const client = new OmegaClient(config);
  const health = await client.health();
  const light = health.ok ? "green" as const : "red" as const;

  console.log(`\nagentic-recall v1.0.0  ${lightEmoji(light)}`);
  console.log(`  OMEGA:        ${health.ok ? "\u2705" : "\u274C"} (${health.dbSize})`);
  console.log(`  Memories:     ${health.memoryCount}`);

  // Show recent activity from event log
  const events = await readLastEvents(5);
  const lastCapture = events.find((e) => e.event === "capture_stored");
  const lastRecall = events.find((e) => e.event === "recall_hit" || e.event === "recall_miss");

  if (lastCapture) {
    console.log(`  Last capture: ${lastCapture.details.type ?? "unknown"} (${lastCapture.duration_ms}ms)`);
  }
  if (lastRecall) {
    console.log(`  Last recall:  ${lastRecall.event === "recall_hit" ? "hit" : "miss"} (${lastRecall.duration_ms}ms)`);
  }

  console.log(`  Transport:    ${config.connectionMode.toUpperCase()}`);
  console.log();
}
