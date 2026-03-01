import type { OpenClawPluginApi, OmegaConfig } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { classify } from "../lib/classifier.ts";
import { formatMemoryEntry } from "../lib/formatter.ts";

export function registerSlashCommands(api: OpenClawPluginApi, client: OmegaClient, _cfg: OmegaConfig): void {
  api.registerCommand(
    {
      name: "remember",
      description: "Store text as a memory (auto-classifies type)",
      acceptsArgs: true,
    },
    async (ctx) => {
      const text = ctx.args?.trim();
      if (!text) {
        return "Usage: /remember <text to remember>";
      }

      const classification = classify(text, "");
      const result = await client.store(text, classification.type);

      if (result.id) {
        return `Remembered as ${classification.type} (confidence: ${classification.confidence.toFixed(2)}): "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`;
      }
      return "Failed to store memory. The OMEGA engine may be unavailable.";
    },
  );

  api.registerCommand(
    {
      name: "recall",
      description: "Search memories and display results",
      acceptsArgs: true,
    },
    async (ctx) => {
      const query = ctx.args?.trim();
      if (!query) {
        return "Usage: /recall <search query>";
      }

      const results = await client.query(query, { limit: 10 });

      if (results.length === 0) {
        return "No memories found matching your query.";
      }

      const formatted = results.map((m) => formatMemoryEntry(m)).join("\n\n");
      return `Found ${results.length} memories:\n\n${formatted}`;
    },
  );
}
