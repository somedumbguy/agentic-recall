import { hostname } from "os";
import type { OmegaConfig, CaptureMode, ConnectionMode, CustomContainer } from "./types/index.ts";

const ALLOWED_KEYS = new Set([
  "omegaPath", "pythonPath", "dbPath", "connectionMode", "udsSocketPath",
  "autoRecall", "maxRecallResults", "profileFrequency", "recallMinScore",
  "autoCapture", "captureMode", "captureMinLength", "captureMaxLength", "dualSave",
  "containerTag", "enableCustomContainerTags", "customContainers", "customContainerInstructions",
  "debug",
]);

function sanitizeTag(tag: string): string {
  return tag
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

function parseBool(val: unknown, fallback: boolean): boolean {
  if (typeof val === "boolean") return val;
  return fallback;
}

function parseNumber(val: unknown, fallback: number, min: number, max: number): number {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(min, Math.min(max, val));
  }
  return fallback;
}

export function parseConfig(raw: unknown): OmegaConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  for (const key of Object.keys(cfg)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Unknown config key: "${key}". Allowed: ${[...ALLOWED_KEYS].join(", ")}`);
    }
  }

  let pythonPath = "python3";
  if (typeof cfg.pythonPath === "string" && cfg.pythonPath.length > 0) {
    pythonPath = resolveEnvVars(cfg.pythonPath);
  }

  let containerTag = `openclaw_${sanitizeTag(hostname())}`;
  if (typeof cfg.containerTag === "string" && cfg.containerTag.length > 0) {
    containerTag = sanitizeTag(cfg.containerTag);
  }

  const customContainers: CustomContainer[] = [];
  if (Array.isArray(cfg.customContainers)) {
    for (const c of cfg.customContainers) {
      if (c && typeof c === "object" && "tag" in c && "description" in c) {
        const cc = c as { tag: unknown; description: unknown };
        if (typeof cc.tag === "string" && typeof cc.description === "string") {
          customContainers.push({ tag: sanitizeTag(cc.tag), description: cc.description });
        }
      }
    }
  }

  return {
    omegaPath: typeof cfg.omegaPath === "string" ? resolveEnvVars(cfg.omegaPath) : "omega",
    pythonPath,
    dbPath: typeof cfg.dbPath === "string" ? resolveEnvVars(cfg.dbPath) : "~/.omega/omega.db",
    connectionMode: (cfg.connectionMode === "uds" ? "uds" : "cli") as ConnectionMode,
    udsSocketPath: typeof cfg.udsSocketPath === "string" ? cfg.udsSocketPath : "",

    autoRecall: parseBool(cfg.autoRecall, true),
    maxRecallResults: parseNumber(cfg.maxRecallResults, 10, 1, 20),
    profileFrequency: parseNumber(cfg.profileFrequency, 50, 1, 500),
    recallMinScore: parseNumber(cfg.recallMinScore, 0.3, 0.0, 1.0),

    autoCapture: parseBool(cfg.autoCapture, true),
    captureMode: (cfg.captureMode === "smart" ? "smart" : "all") as CaptureMode,
    captureMinLength: parseNumber(cfg.captureMinLength, 20, 1, 1000),
    captureMaxLength: parseNumber(cfg.captureMaxLength, 50000, 1000, 500000),
    dualSave: parseBool(cfg.dualSave, true),

    containerTag,
    enableCustomContainerTags: parseBool(cfg.enableCustomContainerTags, false),
    customContainers,
    customContainerInstructions: typeof cfg.customContainerInstructions === "string" ? cfg.customContainerInstructions : "",

    debug: parseBool(cfg.debug, false),
  };
}

export const configSchema = {
  parse: parseConfig,
};
