import { readLastEvents, formatAge } from "./utils.ts";
import { lightEmoji } from "../lib/confidence-light.ts";

export async function run(args: string[]): Promise<void> {
  const count = parseInt(args[0] ?? "20", 10);
  const events = await readLastEvents(Math.min(count, 200));

  if (events.length === 0) {
    console.log("\nNo events in log.");
    return;
  }

  console.log(`\nLast ${events.length} events:\n`);
  // Reverse to show oldest first (readLastEvents returns newest first)
  for (const e of events.reverse()) {
    const age = formatAge(e.timestamp);
    const emoji = lightEmoji(e.light);
    const detail = e.details.type ?? e.details.reason ?? e.details.count ?? "";
    console.log(`${age.padEnd(10)} ${emoji} ${e.event.padEnd(20)} ${e.platform.padEnd(12)} ${e.duration_ms}ms  ${detail}`);
  }
  console.log();
}
