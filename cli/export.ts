import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";

export async function run(args: string[]): Promise<void> {
  const config = getConfigFromEnv();
  const client = new OmegaClient(config);

  // Export all memories by querying with a broad search
  const memories = await client.query("*", { limit: 1000 });

  const output = args.includes("--pretty")
    ? JSON.stringify(memories, null, 2)
    : JSON.stringify(memories);

  process.stdout.write(output + "\n");
}
