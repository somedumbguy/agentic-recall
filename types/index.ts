// ── OMEGA Memory types ──

export interface OmegaMemory {
  id: string;
  content: string;
  type: string;
  score: number;
  created_at: string;
  accessed_count: number;
  tags: string[];
  edges?: { type: string; target_id: string }[];
}

export interface OmegaStoreResult {
  id: string;
}

export interface OmegaDeleteResult {
  deleted: boolean;
}

export interface OmegaHealthResult {
  ok: boolean;
  memoryCount: number;
  dbSize: string;
}

// ── Configuration ──

export type CaptureMode = "all" | "smart";
export type ConnectionMode = "cli" | "uds";

export interface OmegaConfig {
  omegaPath: string;
  pythonPath: string;
  dbPath: string;
  connectionMode: ConnectionMode;
  udsSocketPath: string;

  autoRecall: boolean;
  maxRecallResults: number;
  profileFrequency: number;
  recallMinScore: number;

  autoCapture: boolean;
  captureMode: CaptureMode;
  captureMinLength: number;
  captureMaxLength: number;
  dualSave: boolean;

  containerTag: string;
  enableCustomContainerTags: boolean;
  customContainers: CustomContainer[];
  customContainerInstructions: string;

  debug: boolean;
}

export interface CustomContainer {
  tag: string;
  description: string;
}

// ── Observability ──

export type LightColor = "green" | "yellow" | "red";

export interface ConfidenceSignals {
  recallSuccess: boolean;
  memoriesFound: number;
  memoriesInjected: number;
  topScore: number;
  avgScore: number;
  recallLatency: number;

  recentErrorCount: number;
  recentSkipRate: number;
  recentRecallMissRate: number;
  consecutiveMisses: number;
  avgRecentLatency: number;

  omegaReachable: boolean;
  lastCaptureAge: number;
  lastSuccessfulRecall: number;
}

export interface ConfidenceLightResult {
  color: LightColor;
  reason: string;
}

export type EventType =
  | "recall_start"
  | "recall_hit"
  | "recall_miss"
  | "recall_error"
  | "capture_start"
  | "capture_stored"
  | "capture_skipped"
  | "capture_classified"
  | "capture_error"
  | "self_check"
  | "diagnostic_mode"
  | "connection_mode"
  | "health_check"
  | "config_loaded"
  | "omega_call"
  | "omega_error";

export type Platform = "openclaw" | "claude-code";

export interface LogEvent {
  timestamp: string;
  event: EventType;
  session_id: string;
  platform: Platform;
  duration_ms: number;
  light: LightColor;
  details: Record<string, unknown>;
}

export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface SelfCheckResult {
  overall: LightColor;
  checks: CheckResult[];
  recommendations: string[];
}

export interface RecallEvent {
  hit: boolean;
  topScore: number;
  count: number;
  latency: number;
  timestamp: number;
}

export interface CaptureEvent {
  stored: boolean;
  skipped: boolean;
  type: string;
  timestamp: number;
}

export interface OmegaCallEvent {
  method: string;
  latency: number;
  success: boolean;
  timestamp: number;
}

// ── Classifier ──

export type MemoryType = "decision" | "lesson" | "user_preference" | "error_pattern" | "general";

export interface ClassificationResult {
  type: MemoryType;
  confidence: number;
  extractedFact: string;
}

// ── Plugin API (OpenClaw SDK surface we depend on) ──

export interface OpenClawPluginApi {
  pluginConfig: unknown;
  logger: {
    debug: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  on(event: string, handler: (ctx: EventContext) => Promise<EventResult | void>): void;
  registerTool(definition: ToolDefinition, handler: ToolHandler, options?: { name?: string }): void;
  registerCommand(spec: CommandSpec, handler: CommandHandler): void;
  registerCli(factory: (opts: { program: CliProgram }) => void, options?: { commands?: string[] }): void;
  registerService(lifecycle: ServiceLifecycle): void;
  prependContext(text: string): void;
}

export interface EventContext {
  prompt?: string;
  messages?: ConversationMessage[];
  sessionKey?: string;
  success?: boolean;
}

export interface EventResult {
  prependContext?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: string;
  text?: string;
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolHandler {
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: { type: string; text: string }[];
}

export interface CommandSpec {
  name: string;
  description: string;
  acceptsArgs?: boolean;
}

export type CommandHandler = (ctx: { args?: string }) => Promise<string | void>;

export interface CliProgram {
  command(name: string): CliCommand;
  commands: CliCommand[];
}

export interface CliCommand {
  name(): string;
  description(desc: string): CliCommand;
  argument(name: string, desc: string): CliCommand;
  option(flags: string, desc: string): CliCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): CliCommand;
  command(name: string): CliCommand;
}

export interface ServiceLifecycle {
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
}
