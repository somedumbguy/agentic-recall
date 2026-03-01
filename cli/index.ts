#!/usr/bin/env node
/**
 * agentic-recall CLI entry point
 *
 * Usage: npx agentic-recall <command> [options]
 */

const command = process.argv[2];
const args = process.argv.slice(3);

const COMMANDS: Record<string, () => Promise<{ run: (args: string[]) => Promise<void> }>> = {
  status: () => import("./status.ts"),
  stats: () => import("./stats.ts"),
  doctor: () => import("./doctor.ts"),
  search: () => import("./search.ts"),
  log: () => import("./log.ts"),
  browse: () => import("./browse.ts"),
  export: () => import("./export.ts"),
  prune: () => import("./prune.ts"),
  light: () => import("./light.ts"),
};

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    console.log(`agentic-recall — memory system CLI

Commands:
  status    Quick health overview + confidence light
  stats     Usage statistics (last 7 days)
  doctor    Comprehensive health check (16 checks)
  search    Search memories by query
  log       Tail the event log
  browse    Paginated memory browser
  export    Export all memories as JSON
  prune     Remove low-value memories
  light     Inspect confidence light + signal breakdown

Usage: npx agentic-recall <command> [options]`);
    return;
  }

  const loader = COMMANDS[command];
  if (!loader) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run "npx agentic-recall --help" for available commands.`);
    process.exit(1);
  }

  const mod = await loader();
  await mod.run(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
