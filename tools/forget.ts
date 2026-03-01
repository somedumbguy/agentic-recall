import type { OpenClawPluginApi, OmegaConfig } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";

export function registerForgetTool(api: OpenClawPluginApi, client: OmegaClient, _cfg: OmegaConfig): void {
  api.registerTool(
    {
      name: "omega_forget",
      label: "Memory Forget",
      description: "Delete a specific memory by ID or search query. Use when information is outdated or the user asks you to forget something.",
      parameters: {
        memoryId: { type: "string", description: "Specific memory ID to delete" },
        query: { type: "string", description: "Search query to find and delete matching memory" },
      },
    },
    {
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const memoryId = params.memoryId as string | undefined;
        const query = params.query as string | undefined;

        if (memoryId) {
          const result = await client.delete(memoryId);
          if (result.deleted) {
            return { content: [{ type: "text", text: `Deleted memory ${memoryId}.` }] };
          }
          return { content: [{ type: "text", text: `Could not delete memory ${memoryId}. It may not exist.` }] };
        }

        if (query) {
          const results = await client.query(query, { limit: 1 });
          if (results.length === 0) {
            return { content: [{ type: "text", text: "No matching memory found to delete." }] };
          }
          const match = results[0]!;
          const deleted = await client.delete(match.id);
          if (deleted.deleted) {
            return { content: [{ type: "text", text: `Deleted memory: "${match.content.slice(0, 100)}..."` }] };
          }
          return { content: [{ type: "text", text: "Found a match but could not delete it." }] };
        }

        return { content: [{ type: "text", text: "Please provide either a memoryId or query to find the memory to delete." }] };
      },
    },
  );
}
