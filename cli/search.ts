import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";
import { formatMemoryEntry } from "../lib/formatter.ts";

export async function run(args: string[]): Promise<void> {
  const query = args.join(" ");
  if (!query) {
    console.error("Usage: npx agentic-recall search <query>");
    process.exit(1);
  }

  const config = getConfigFromEnv();
  const client = new OmegaClient(config);

  const limit = 10;
  const memories = await client.query(query, { limit });

  if (memories.length === 0) {
    console.log("\nNo memories found.");
    return;
  }

  console.log(`\nFound ${memories.length} memories:\n`);
  for (const mem of memories) {
    console.log(formatMemoryEntry(mem));
    console.log();
  }
}
