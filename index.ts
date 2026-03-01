import type { OpenClawPluginApi } from "./types/index.ts";
import { parseConfig, configSchema } from "./config.ts";
import { initLogger, log } from "./logger.ts";
import { OmegaClient } from "./lib/omega-client.ts";
import { buildRecallHandler } from "./hooks/recall.ts";
import { buildCaptureHandler } from "./hooks/capture.ts";
import { registerSearchTool } from "./tools/search.ts";
import { registerStoreTool } from "./tools/store.ts";
import { registerForgetTool } from "./tools/forget.ts";
import { registerProfileTool } from "./tools/profile.ts";
import { registerSlashCommands } from "./commands/slash.ts";
import { registerCliCommands } from "./commands/cli.ts";

export default {
  id: "openclaw-omega",
  name: "OMEGA Memory",
  description: "Automatic memory capture and recall backed by OMEGA's local-first memory engine",
  kind: "memory" as const,
  configSchema,

  register(api: OpenClawPluginApi): void {
    const cfg = parseConfig(api.pluginConfig);
    initLogger(api.logger, cfg.debug);

    log.debug("Initializing OMEGA plugin...");

    const client = new OmegaClient(cfg);

    // Session key closure for capture hook
    let sessionKey: string | undefined;
    const getSessionKey = () => sessionKey;

    // Register hooks
    if (cfg.autoRecall) {
      const recallHandler = buildRecallHandler(client, cfg);
      api.on("before_agent_start", async (ctx) => {
        sessionKey = ctx.sessionKey;
        return recallHandler(ctx);
      });
      log.debug("Auto-recall hook registered");
    }

    if (cfg.autoCapture) {
      const captureHandler = buildCaptureHandler(client, cfg, getSessionKey);
      api.on("agent_end", async (ctx) => {
        await captureHandler(ctx);
      });
      log.debug("Auto-capture hook registered");
    }

    // Register tools
    registerSearchTool(api, client, cfg);
    registerStoreTool(api, client, cfg);
    registerForgetTool(api, client, cfg);
    registerProfileTool(api, client, cfg);

    // Register commands
    registerSlashCommands(api, client, cfg);
    registerCliCommands(api, client, cfg);

    // Register service lifecycle
    api.registerService({
      start: async () => {
        log.debug("OMEGA plugin starting...");
        const health = await client.health();
        if (health.ok) {
          log.debug("OMEGA engine is healthy");
        } else {
          log.warn("OMEGA engine is not available — memory features will be degraded");
        }
      },
      stop: async () => {
        log.debug("OMEGA plugin stopping");
      },
    });

    log.debug("OMEGA plugin initialized successfully");
  },
};
