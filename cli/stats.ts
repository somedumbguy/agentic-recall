import { readAllEvents } from "./utils.ts";
import { lightEmoji } from "../lib/confidence-light.ts";
import type { LightColor } from "../types/index.ts";

export async function run(_args: string[]): Promise<void> {
  const events = await readAllEvents();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => new Date(e.timestamp).getTime() > sevenDaysAgo);

  if (recent.length === 0) {
    console.log("\nNo events in the last 7 days.");
    return;
  }

  // Light distribution
  const lightCounts: Record<LightColor, number> = { green: 0, yellow: 0, red: 0 };
  for (const e of recent) lightCounts[e.light]++;
  const totalLight = recent.length;

  console.log("\n=== agentic-recall Statistics (last 7 days) ===\n");

  console.log("CONFIDENCE LIGHT");
  for (const c of ["green", "yellow", "red"] as LightColor[]) {
    const pct = totalLight > 0 ? ((lightCounts[c] / totalLight) * 100).toFixed(0) : "0";
    console.log(`  ${lightEmoji(c)} ${c.charAt(0).toUpperCase() + c.slice(1).padEnd(8)} ${pct}% of events`);
  }

  // Capture stats
  const stored = recent.filter((e) => e.event === "capture_stored");
  const skipped = recent.filter((e) => e.event === "capture_skipped");

  console.log("\nCAPTURE");
  console.log(`  Total:        ${stored.length} stored, ${skipped.length} skipped`);

  const byType: Record<string, number> = {};
  for (const e of stored) {
    const t = String(e.details.type ?? "general");
    byType[t] = (byType[t] ?? 0) + 1;
  }
  if (Object.keys(byType).length > 0) {
    console.log(`  By type:      ${Object.entries(byType).map(([t, n]) => `${t}: ${n}`).join("  ")}`);
  }

  const skipReasons: Record<string, number> = {};
  for (const e of skipped) {
    const r = String(e.details.reason ?? "unknown");
    skipReasons[r] = (skipReasons[r] ?? 0) + 1;
  }
  if (Object.keys(skipReasons).length > 0) {
    console.log(`  Skip reasons: ${Object.entries(skipReasons).map(([r, n]) => `${r}: ${n}`).join("  ")}`);
  }

  // Recall stats
  const hits = recent.filter((e) => e.event === "recall_hit");
  const misses = recent.filter((e) => e.event === "recall_miss");
  const totalRecalls = hits.length + misses.length;
  const hitRate = totalRecalls > 0 ? ((hits.length / totalRecalls) * 100).toFixed(0) : "0";

  console.log("\nRECALL");
  console.log(`  Total:        ${totalRecalls} (${hits.length} hits, ${misses.length} misses — ${hitRate}% hit rate)`);

  const recallLatencies = [...hits, ...misses].map((e) => e.duration_ms).filter((d) => d > 0);
  if (recallLatencies.length > 0) {
    const avg = Math.round(recallLatencies.reduce((a, b) => a + b, 0) / recallLatencies.length);
    console.log(`  Avg latency:  ${avg}ms`);
  }

  // Self-check stats
  const checks = recent.filter((e) => e.event === "self_check");
  if (checks.length > 0) {
    const checkLights: Record<LightColor, number> = { green: 0, yellow: 0, red: 0 };
    for (const e of checks) checkLights[e.light]++;
    console.log("\nSELF-CHECKS");
    console.log(`  Ran: ${checks.length} checks`);
    console.log(`  Results: ${lightEmoji("green")} ${checkLights.green}  ${lightEmoji("yellow")} ${checkLights.yellow}  ${lightEmoji("red")} ${checkLights.red}`);
  }

  console.log();
}
