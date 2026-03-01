import type { OpenClawPluginApi, OmegaConfig } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";

export function registerStoreTool(api: OpenClawPluginApi, client: OmegaClient, _cfg: OmegaConfig): void {
  api.registerTool(
    {
      name: "omega_store",
      label: "Memory Store",
      description: "Explicitly store something in long-term memory. Use when the user says 'remember this' or you want to save an important decision/lesson.",
      parameters: {
        content: { type: "string", description: "What to remember", required: true },
        type: {
          type: "string",
          description: "Memory type",
          enum: ["decision", "lesson", "user_preference", "error_pattern", "general"],
          default: "general",
        },
      },
    },
    {
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const content = params.content as string;
        const type = (params.type as string) ?? "general";

        const result = await client.store(content, type);

        if (result.id) {
          return { content: [{ type: "text", text: `Stored memory (${type}): "${content.slice(0, 100)}${content.length > 100 ? "..." : ""}"` }] };
        }
        return { content: [{ type: "text", text: "Failed to store memory. The memory engine may be unavailable." }] };
      },
    },
  );
}
