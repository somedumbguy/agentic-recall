import type { OpenClawPluginApi, OmegaConfig } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { formatMemoryEntry } from "../lib/formatter.ts";

export function registerCliCommands(api: OpenClawPluginApi, client: OmegaClient, cfg: OmegaConfig): void {
  api.registerCli(
    ({ program }) => {
      const omega = program.command("omega").description("OMEGA memory engine commands");

      omega
        .command("status")
        .description("Show config, memory count, DB size")
        .action(async () => {
          const health = await client.health();
          console.log(`OMEGA Status:`);
          console.log(`  Engine:    ${health.ok ? "OK" : "UNAVAILABLE"}`);
          console.log(`  Memories:  ${health.memoryCount}`);
          console.log(`  DB Size:   ${health.dbSize}`);
          console.log(`  Auto-Recall: ${cfg.autoRecall}`);
          console.log(`  Auto-Capture: ${cfg.autoCapture}`);
          console.log(`  Capture Mode: ${cfg.captureMode}`);
          console.log(`  Container: ${cfg.containerTag}`);
        });

      omega
        .command("search")
        .description("Search memories from terminal")
        .argument("<query>", "Search query")
        .action(async (...args: unknown[]) => {
          const query = args[0] as string;
          const results = await client.query(query, { limit: 10 });
          if (results.length === 0) {
            console.log("No memories found.");
            return;
          }
          console.log(`Found ${results.length} memories:\n`);
          for (const m of results) {
            console.log(formatMemoryEntry(m));
            console.log();
          }
        });

      omega
        .command("profile")
        .description("Display user profile")
        .action(async () => {
          const profile = await client.getProfile();
          if (profile.length === 0) {
            console.log("No profile data yet.");
            return;
          }
          console.log("User Profile:\n");
          for (const m of profile) {
            console.log(`  - ${m.content}`);
          }
        });

      omega
        .command("wipe")
        .description("Delete all memories (requires confirmation)")
        .option("--confirm", "Skip confirmation prompt")
        .action(async (...args: unknown[]) => {
          const opts = (args[0] ?? {}) as { confirm?: boolean };
          if (!opts.confirm) {
            console.log("This will delete ALL memories. Run with --confirm to proceed.");
            return;
          }
          console.log("Wiping all memories is not yet supported in CLI mode.");
          console.log("Use the OMEGA Python CLI directly: omega wipe --confirm");
        });

      omega
        .command("stats")
        .description("Show memory statistics")
        .action(async () => {
          const health = await client.health();
          console.log(`Memory Statistics:`);
          console.log(`  Total Memories: ${health.memoryCount}`);
          console.log(`  Database Size:  ${health.dbSize}`);
        });

      omega
        .command("doctor")
        .description("Verify OMEGA installation and health")
        .action(async () => {
          console.log("Running OMEGA diagnostics...\n");
          const health = await client.health();
          console.log(`  Python Path:    ${cfg.pythonPath}`);
          console.log(`  OMEGA Engine:   ${health.ok ? "OK" : "NOT AVAILABLE"}`);
          console.log(`  Database:       ${cfg.dbPath}`);
          console.log(`  Memory Count:   ${health.memoryCount}`);
          if (!health.ok) {
            console.log("\n  ISSUE: OMEGA engine is not responding.");
            console.log("  Try: pip3 install omega-memory[server] && omega setup");
          } else {
            console.log("\n  All checks passed!");
          }
        });
    },
    { commands: ["omega"] },
  );
}
