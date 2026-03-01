import type { OpenClawPluginApi, OmegaConfig } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";
import { formatMemoryEntry } from "../lib/formatter.ts";

export function registerSearchTool(api: OpenClawPluginApi, client: OmegaClient, _cfg: OmegaConfig): void {
  api.registerTool(
    {
      name: "omega_search",
      label: "Memory Search",
      description: "Search long-term memory for relevant information. Use when auto-recalled memories don't contain what you need.",
      parameters: {
        query: { type: "string", description: "Search query", required: true },
        type: {
          type: "string",
          description: "Filter by memory type",
          enum: ["decision", "lesson", "user_preference", "error_pattern", "general", "conversation_chunk"],
        },
        limit: { type: "number", description: "Max results (default 5)", default: 5 },
      },
    },
    {
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const query = params.query as string;
        const type = params.type as string | undefined;
        const limit = (params.limit as number) ?? 5;

        const results = await client.query(query, { type, limit });

        if (results.length === 0) {
          return { content: [{ type: "text", text: "No memories found matching your query." }] };
        }

        const formatted = results.map((m) => formatMemoryEntry(m)).join("\n\n");
        return { content: [{ type: "text", text: `Found ${results.length} memories:\n\n${formatted}` }] };
      },
    },
  );
}
