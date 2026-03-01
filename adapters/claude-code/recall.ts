#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — RECALL
 *
 * Reads hook JSON from stdin, queries OMEGA for relevant memories,
 * and outputs JSON with additionalContext for prompt injection.
 * Fail-open: any error → exit 0 silently.
 */
import { getConfigFromEnv } from "../../config.ts";
import { OmegaClient } from "../../lib/omega-client.ts";
import { deduplicateMemories } from "../../lib/dedup.ts";
import { formatMemoriesBlock } from "../../lib/formatter.ts";
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

export async function handleRecall(
  input: RecallHookInput,
  clientOverride?: OmegaClient,
): Promise<RecallHookOutput | null> {
  const config = getConfigFromEnv();
  initLogger(undefined, config.debug);

  if (!config.autoRecall) return null;

  const prompt = input.prompt;
  if (!prompt || prompt.length < 5) return null;

  const client = clientOverride ?? new OmegaClient(config);
  const memories = await client.query(prompt, { limit: config.maxRecallResults });

  const filtered = memories.filter((m) => m.score >= config.recallMinScore);
  if (filtered.length === 0) return null;

  const deduped = deduplicateMemories(filtered);
  const block = formatMemoriesBlock(deduped);
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
