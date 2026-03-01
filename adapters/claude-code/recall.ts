#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — RECALL
 *
 * Reads hook JSON from stdin, queries OMEGA for relevant memories,
 * and outputs JSON with additionalContext for prompt injection.
 * Includes confidence light, event logging, and self-check.
 * Fail-open: any error → exit 0 silently.
 */
import { getConfigFromEnv } from "../../config.ts";
import { OmegaClient } from "../../lib/omega-client.ts";
import { deduplicateMemories } from "../../lib/dedup.ts";
import { formatMemoriesBlock } from "../../lib/formatter.ts";
import { computeLight, lightEmoji } from "../../lib/confidence-light.ts";
import { ConfidenceState } from "../../lib/confidence-state.ts";
import { SelfChecker } from "../../lib/self-check.ts";
import { getEventLogger } from "../../lib/event-log.ts";
import { initLogger } from "../../logger.ts";

export interface RecallHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  prompt: string;
}

export interface RecallHookOutput {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;
  };
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 5000);
  });
}

// Module-level singletons (persist across hook invocations in same process)
let _confidenceState: ConfidenceState | null = null;
let _selfChecker: SelfChecker | null = null;

function getConfidenceState(): ConfidenceState {
  if (!_confidenceState) _confidenceState = new ConfidenceState();
  return _confidenceState;
}

export interface RecallDeps {
  client: OmegaClient;
  confidenceState?: ConfidenceState;
  selfChecker?: SelfChecker;
}

export async function handleRecall(
  input: RecallHookInput,
  clientOverride?: OmegaClient,
  depsOverride?: Partial<RecallDeps>,
): Promise<RecallHookOutput | null> {
  const config = getConfigFromEnv();
  initLogger(undefined, config.debug);

  if (!config.autoRecall) return null;

  const prompt = input.prompt;
  if (!prompt || prompt.length < 5) return null;

  const client = depsOverride?.client ?? clientOverride ?? new OmegaClient(config);
  const confidenceState = depsOverride?.confidenceState ?? getConfidenceState();
  const eventLogger = getEventLogger();

  const startTime = Date.now();
  let recallSuccess = true;
  let memories: Awaited<ReturnType<OmegaClient["query"]>> = [];

  try {
    memories = await client.query(prompt, { limit: config.maxRecallResults });
    confidenceState.recordOmegaCall("query", Date.now() - startTime, true);
  } catch {
    recallSuccess = false;
    confidenceState.recordOmegaCall("query", Date.now() - startTime, false);
    confidenceState.recordError();
  }

  const latency = Date.now() - startTime;
  const filtered = memories.filter((m) => m.score >= config.recallMinScore);
  const deduped = deduplicateMemories(filtered);

  const hit = deduped.length > 0;
  const topScore = deduped.length > 0 ? Math.max(...deduped.map((m) => m.score)) : 0;
  const avgScore = deduped.length > 0 ? deduped.reduce((s, m) => s + m.score, 0) / deduped.length : 0;

  confidenceState.recordRecall(hit, topScore, deduped.length, latency);

  // Compute confidence light
  const signals = confidenceState.getSignals({
    success: recallSuccess,
    found: memories.length,
    injected: deduped.length,
    topScore,
    avgScore,
    latency,
  });
  const light = computeLight(signals);

  // Log event
  await eventLogger.log(
    hit ? "recall_hit" : "recall_miss",
    input.session_id,
    "claude-code",
    latency,
    light.color,
    { count: deduped.length, topScore, prompt: prompt.slice(0, 100), light_reason: light.reason },
  );

  // Self-check (if due)
  if (!_selfChecker) {
    _selfChecker = new SelfChecker({
      getSignals: () => confidenceState.getSignals(),
      omegaHealth: async () => (await client.health()).ok,
    });
  }
  const selfChecker = depsOverride?.selfChecker ?? _selfChecker;
  const checkResult = await selfChecker.checkIfDue();
  if (checkResult) {
    await eventLogger.log("self_check", input.session_id, "claude-code", 0, checkResult.overall, {
      checks: checkResult.checks,
      recommendations: checkResult.recommendations,
      triggered_by: "turns",
    });
  }

  // Format memories with confidence light footer
  const block = formatMemoriesBlock(deduped, undefined, {
    light,
    count: deduped.length,
    latencyMs: latency,
  });

  // Stderr output for verbose mode
  const emoji = lightEmoji(light.color);
  if (hit) {
    console.error(`[agentic-recall] ${emoji} ${deduped.length} memories injected (${latency}ms, top: ${topScore.toFixed(2)})`);
  } else if (light.color !== "green") {
    console.error(`[agentic-recall] ${emoji} 0 memories${light.reason ? ", " + light.reason : ""} (${latency}ms)`);
  }

  await eventLogger.flush();

  if (!block) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: block,
    },
  };
}

async function main(): Promise<void> {
  let input: RecallHookInput;
  try {
    const stdin = await readStdin();
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  try {
    const result = await handleRecall(input!);
    if (result) {
      process.stdout.write(JSON.stringify(result));
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

main();
