import type { OpenClawPluginApi, OmegaConfig } from "../types/index.ts";
import type { OmegaClient } from "../lib/omega-client.ts";

export function registerProfileTool(api: OpenClawPluginApi, client: OmegaClient, _cfg: OmegaConfig): void {
  api.registerTool(
    {
      name: "omega_profile",
      label: "User Profile",
      description: "Retrieve the user's accumulated profile — preferences, common patterns, and key decisions.",
      parameters: {},
    },
    {
      execute: async () => {
        const preferences = await client.getProfile();
        const decisions = await client.query("key decisions", { type: "decision", limit: 5 });
        const errors = await client.query("common errors", { type: "error_pattern", limit: 5 });

        const parts: string[] = [];

        if (preferences.length > 0) {
          parts.push("## Preferences");
          for (const p of preferences) {
            parts.push(`- ${p.content}`);
          }
        }

        if (decisions.length > 0) {
          parts.push("\n## Key Decisions");
          for (const d of decisions) {
            parts.push(`- ${d.content}`);
          }
        }

        if (errors.length > 0) {
          parts.push("\n## Known Error Patterns");
          for (const e of errors) {
            parts.push(`- ${e.content}`);
          }
        }

        if (parts.length === 0) {
          return { content: [{ type: "text", text: "No profile data found yet. Use the system for a while to accumulate preferences and decisions." }] };
        }

        return { content: [{ type: "text", text: parts.join("\n") }] };
      },
    },
  );
}
