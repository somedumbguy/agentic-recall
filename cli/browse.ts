import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";
import { formatMemoryEntry } from "../lib/formatter.ts";

export async function run(args: string[]): Promise<void> {
  const typeFilter = args.find((a) => !a.startsWith("-"));
  const limit = 20;

  const config = getConfigFromEnv();
  const client = new OmegaClient(config);

  // Browse by querying with a generic query, optionally filtered by type
  const opts: { type?: string; limit: number } = { limit };
  if (typeFilter) opts.type = typeFilter;

  const memories = await client.query("*", opts);

  if (memories.length === 0) {
    console.log(typeFilter ? `\nNo ${typeFilter} memories found.` : "\nNo memories found.");
    return;
  }

  console.log(`\n${memories.length} memories${typeFilter ? ` (type: ${typeFilter})` : ""}:\n`);
  for (let i = 0; i < memories.length; i++) {
    console.log(`#${i + 1}`);
    console.log(formatMemoryEntry(memories[i]!));
    console.log();
  }
}
