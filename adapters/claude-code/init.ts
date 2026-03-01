#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — INIT
 *
 * Verifies OMEGA Python engine is available and config is valid.
 * Logs warnings to stderr (shown in verbose mode).
 * Always exits 0 — never blocks session startup.
 */
import { execFileSync } from "child_process";
import { getConfigFromEnv } from "../../config.ts";

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

  try {
    execFileSync(config.pythonPath, ["-c", "from omega import store, query"], {
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    console.error("[agentic-recall] Warning: OMEGA not found. Memory features disabled.");
    console.error("[agentic-recall] Install with: pip install omega-memory");
  }
}

async function main(): Promise<void> {
  try {
    // Consume stdin (required by hook protocol)
    await readStdin();
    await handleInit();
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
