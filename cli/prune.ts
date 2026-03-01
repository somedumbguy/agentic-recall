import { getConfigFromEnv } from "../config.ts";
import { OmegaClient } from "../lib/omega-client.ts";
import { formatAge } from "./utils.ts";

const META_PATTERNS = [
  /memory.*(status|health|check|diagnos)/i,
  /confidence.*light/i,
  /agentic.recall.*(stats|doctor|error)/i,
  /OMEGA.*(error|unreachable|status|version)/i,
];

export async function run(args: string[]): Promise<void> {
  const config = getConfigFromEnv();
  const client = new OmegaClient(config);
  const dryRun = args.includes("--dry-run");
  const metaOnly = args.includes("--meta");

  let candidates: Awaited<ReturnType<OmegaClient["query"]>> = [];

  if (metaOnly) {
    // Search for meta-memory pollution
    const results = await client.query("memory status health check diagnostic confidence light", { limit: 50 });
    candidates = results.filter((m) =>
      META_PATTERNS.some((p) => p.test(m.content)),
    );
  } else {
    // Prune low-score general memories
    const results = await client.query("*", { limit: 200 });
    candidates = results.filter((m) =>
      m.type === "general" && m.score < 0.3 && m.accessed_count <= 1,
    );
  }

  if (candidates.length === 0) {
    console.log(metaOnly ? "\nNo meta-memory pollution found." : "\nNothing to prune.");
    return;
  }

  const label = metaOnly ? "meta-memory" : "low-value";

  if (dryRun) {
    console.log(`\nWould remove ${candidates.length} ${label} entries:\n`);
    for (const m of candidates) {
      const age = formatAge(m.created_at);
      console.log(`  - "${m.content.slice(0, 80)}${m.content.length > 80 ? "..." : ""}" (${m.type}, ${age})`);
    }
    return;
  }

  let removed = 0;
  for (const m of candidates) {
    const result = await client.delete(m.id);
    if (result.deleted) removed++;
  }

  console.log(`\nRemoved ${removed} ${label} entries.`);
}
