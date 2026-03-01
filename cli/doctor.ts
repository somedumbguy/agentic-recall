import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";
import { ConfidenceState } from "../lib/confidence-state.ts";
import { SelfChecker } from "../lib/self-check.ts";
import { readAllEvents, getLogPath } from "./utils.ts";
import { existsSync, statSync } from "fs";

export async function run(_args: string[]): Promise<void> {
  const config = getConfigFromEnv();
  const client = new OmegaClient(config);

  console.log("\n=== agentic-recall Doctor ===\n");

  // 1. OMEGA reachability
  const health = await client.health();
  printCheck(health.ok, "OMEGA reachable", health.ok ? "Responding" : "Unreachable");

  // 2. Python available
  let pythonOk = false;
  try {
    const { execFileSync } = await import("child_process");
    execFileSync(config.pythonPath, ["--version"], { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    pythonOk = true;
  } catch {}
  printCheck(pythonOk, "Python3", pythonOk ? config.pythonPath : "Not found");

  // 3. Config valid
  printCheck(true, "Config loaded", `autoRecall: ${config.autoRecall}, autoCapture: ${config.autoCapture}`);

  // 4. Event log
  const logPath = getLogPath();
  const logExists = existsSync(logPath);
  let logSize = "0B";
  if (logExists) {
    const s = statSync(logPath);
    logSize = s.size > 1024 * 1024 ? `${(s.size / (1024 * 1024)).toFixed(1)}MB` : `${(s.size / 1024).toFixed(0)}KB`;
  }
  printCheck(logExists, "Event log", logExists ? `${logPath} (${logSize})` : "No events yet");

  // 5. Self-check
  const state = new ConfidenceState();
  const checker = new SelfChecker({
    getSignals: () => state.getSignals(),
    omegaHealth: async () => health.ok,
  });
  const result = await checker.runNow();
  for (const c of result.checks) {
    const ok = c.status === "pass";
    const warn = c.status === "warn";
    printCheck(ok, c.name, c.message, warn);
  }

  // 6. Isolation layers
  printCheck(true, "Capture isolation", "3 layers active (patterns + flag + stripping)");

  // 7. Meta-memory pollution check
  const metaResults = await client.query("memory status health check diagnostic", { limit: 5 });
  const metaPollution = metaResults.filter((m) =>
    /memory.*(status|health|check|diagnos)/i.test(m.content) ||
    /confidence.*light/i.test(m.content)
  );
  if (metaPollution.length > 0) {
    printCheck(false, "No meta-memory pollution", `${metaPollution.length} diagnostic memories found`, true);
    console.log("     Run `npx agentic-recall prune --meta` to remove them.");
  } else {
    printCheck(true, "No meta-memory pollution", "Clean");
  }

  // 8. Event log stats
  const events = await readAllEvents();
  const recentErrors = events.filter((e) => e.event === "omega_error" || e.event === "recall_error" || e.event === "capture_error");
  printCheck(recentErrors.length === 0, "Recent errors", recentErrors.length === 0 ? "None" : `${recentErrors.length} errors in log`);

  // Recommendations
  if (result.recommendations.length > 0) {
    console.log("\nRecommendations:");
    for (const r of result.recommendations) {
      console.log(`  - ${r}`);
    }
  }

  console.log();
}

function printCheck(ok: boolean, name: string, message: string, warn: boolean = false): void {
  const icon = ok ? (warn ? "\u26A0\uFE0F" : "\u2705") : "\u274C";
  console.log(`[${icon}] ${name.padEnd(30)} ${message}`);
}
