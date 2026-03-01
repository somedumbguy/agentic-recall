#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — INIT
 *
 * Verifies OMEGA Python engine is available and config is valid.
 * Logs init events. Always exits 0 — never blocks session startup.
 */
import { execFileSync } from "child_process";
import { getConfigFromEnv } from "../../config.ts";
import { getEventLogger } from "../../lib/event-log.ts";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 5000);
  });
}

export async function handleInit(): Promise<void> {
  const config = getConfigFromEnv();
  const eventLogger = getEventLogger();

  await eventLogger.log("config_loaded", "init", "claude-code", 0, "green", {
    autoRecall: config.autoRecall,
    autoCapture: config.autoCapture,
    pythonPath: config.pythonPath,
  });

  let omegaOk = false;
  try {
    execFileSync(config.pythonPath, ["-c", "from omega import store, query"], {
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    omegaOk = true;
  } catch {
    console.error("[agentic-recall] Warning: OMEGA not found. Memory features disabled.");
    console.error("[agentic-recall] Install with: pip install omega-memory");
  }

  await eventLogger.log("health_check", "init", "claude-code", 0, omegaOk ? "green" : "red", {
    omega_available: omegaOk,
  });

  if (omegaOk) {
    console.error("[agentic-recall] initialized \u{1F7E2}");
  }

  await eventLogger.flush();
}

async function main(): Promise<void> {
  try {
    await readStdin();
    await handleInit();
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
