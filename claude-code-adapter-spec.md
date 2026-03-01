# Claude Code Adapter — Implementation Spec for agentic-recall

## Overview

Add a Claude Code adapter to agentic-recall so the same core memory logic (classifier, omega-client, formatter) works in Claude Code via its hooks system. The adapter lives in `adapters/claude-code/` and consists of hook scripts + a hooks config file.

## How Claude Code Hooks Work

Claude Code hooks are shell commands that:
- Receive JSON on **stdin** with session/event context
- Communicate back via **exit codes** and **stdout** (JSON)
- Are configured in `.claude/settings.json` or `.claude/settings.local.json`

Key events we use:

| Event | When It Fires | Our Use |
|-------|--------------|---------|
| `UserPromptSubmit` | User submits a prompt, before Claude processes it | **RECALL** — semantic search for relevant memories, inject via `additionalContext` |
| `Stop` | Claude finishes responding | **CAPTURE** — extract last turn, classify, store in OMEGA |
| `SessionStart` | Session starts/resumes/compacts | **INIT** — verify OMEGA is available, load config |

### Why These Events (Not PreToolUse/PostToolUse)

- `UserPromptSubmit` is better than `PreToolUse` for recall because it fires ONCE per user message, not once per tool call. Memory injection should happen once per turn, not on every `Bash`, `Write`, `Edit` call.
- `Stop` is better than `PostToolUse` for capture because we want the complete agent response, not partial tool outputs. The transcript file contains the full conversation.

## Hook Input/Output Schemas

### UserPromptSubmit (Recall Hook)

**Input (stdin):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Set up the database connection for the orders service"
}
```

**Output (stdout, exit 0):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "=== RELEVANT MEMORIES (auto-recalled) ===\n\n[decision | 2 hours ago | score: 0.87 | accessed: 3x]\nChose PostgreSQL over MongoDB for orders service — need ACID for payments.\n\n[user_preference | 3 days ago | score: 0.82 | accessed: 7x]\nAlways use early returns. Never nest more than 2 levels.\n\n=== END MEMORIES ==="
  }
}
```

If no memories found or OMEGA errors, just `exit 0` with no output (fail-open).

### Stop (Capture Hook)

**Input (stdin):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": false
}
```

**Output:** Just `exit 0`. Capture runs as a side effect (stores to OMEGA). We do NOT block Claude from stopping.

**CRITICAL:** If `stop_hook_active` is `true`, exit immediately with `exit 0`. This prevents infinite loops where a Stop hook keeps blocking Claude from finishing.

### SessionStart (Init Hook)

**Input (stdin):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "permission_mode": "default",
  "hook_event_name": "SessionStart",
  "source": "startup"
}
```

**Output:** `exit 0`. Log any init errors to stderr (shown to user in verbose mode).

## Files to Create

### 1. `adapters/claude-code/recall.ts`

Node.js script that:
1. Reads JSON from stdin
2. Extracts `prompt` field (the user's message)
3. Calls `core/omega-client.ts` → `query(prompt)`
4. Calls `core/formatter.ts` → format memories for injection
5. Outputs JSON with `additionalContext` to stdout
6. Exits 0

```typescript
#!/usr/bin/env node
import { query } from '../../core/omega-client';
import { formatMemories } from '../../core/formatter';
import { getConfig } from '../../core/config';

async function main() {
  const config = getConfig();
  if (!config.autoRecall) process.exit(0);

  let input: any;
  try {
    const stdin = await readStdin();
    input = JSON.parse(stdin);
  } catch {
    process.exit(0); // fail-open
  }

  const prompt = input.prompt;
  if (!prompt || prompt.length < 5) process.exit(0);

  try {
    const memories = await query(prompt, config.maxRecallResults);
    if (!memories || memories.length === 0) process.exit(0);

    const formatted = formatMemories(memories, config);
    
    const output = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: formatted
      }
    };
    
    process.stdout.write(JSON.stringify(output));
  } catch {
    // fail-open: if OMEGA errors, just continue without memories
  }
  
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    setTimeout(() => resolve(data), 5000); // 5s timeout
  });
}

main();
```

### 2. `adapters/claude-code/capture.ts`

Node.js script that:
1. Reads JSON from stdin
2. Checks `stop_hook_active` — if true, exit immediately
3. Reads transcript file to get last user+assistant turn
4. Calls `core/classifier.ts` → classify the turn
5. Calls `core/omega-client.ts` → `store()` with classified type + raw chunk
6. Exits 0

```typescript
#!/usr/bin/env node
import { readFileSync } from 'fs';
import { classify } from '../../core/classifier';
import { store } from '../../core/omega-client';
import { sanitize, validate } from '../../core/sanitize';
import { getConfig } from '../../core/config';

async function main() {
  const config = getConfig();
  if (!config.autoCapture) process.exit(0);

  let input: any;
  try {
    const stdin = await readStdin();
    input = JSON.parse(stdin);
  } catch {
    process.exit(0);
  }

  // CRITICAL: prevent infinite loops
  if (input.stop_hook_active) process.exit(0);

  try {
    // Read transcript to get last turn
    const transcript = readTranscript(input.transcript_path);
    const lastTurn = extractLastTurn(transcript);
    
    if (!lastTurn) process.exit(0);

    const sanitized = sanitize(lastTurn.user + '\n' + lastTurn.assistant);
    if (!validate(sanitized, config)) process.exit(0);

    // Classify
    const classification = classify(lastTurn.user, lastTurn.assistant);

    // Dual save
    // Save A: extracted fact with type
    await store(classification.extractedFact, classification.type, {
      session_id: input.session_id,
      confidence: classification.confidence
    });

    // Save B: raw conversation chunk
    if (config.dualSave) {
      await store(sanitized, 'conversation_chunk', {
        session_id: input.session_id
      });
    }
  } catch {
    // fail-open
  }

  process.exit(0);
}

function readTranscript(path: string): any[] {
  const content = readFileSync(path, 'utf-8');
  return content.trim().split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function extractLastTurn(transcript: any[]): { user: string; assistant: string } | null {
  // Walk backwards to find last user message and last assistant message
  let assistant = '';
  let user = '';
  
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (entry.role === 'assistant' && !assistant) {
      assistant = typeof entry.content === 'string' 
        ? entry.content 
        : entry.content?.map((b: any) => b.text || '').join('') || '';
    }
    if (entry.role === 'user' && !user) {
      user = typeof entry.content === 'string'
        ? entry.content
        : entry.content?.map((b: any) => b.text || '').join('') || '';
    }
    if (user && assistant) break;
  }
  
  if (!user || !assistant) return null;
  return { user, assistant };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    setTimeout(() => resolve(data), 5000);
  });
}

main();
```

### 3. `adapters/claude-code/init.ts`

Node.js script that:
1. Verifies OMEGA Python engine is available
2. Loads and validates config
3. Exits 0 on success, logs warnings to stderr

```typescript
#!/usr/bin/env node
import { execSync } from 'child_process';

async function main() {
  try {
    // Check OMEGA is installed
    execSync('python3 -c "from omega import store, query"', { 
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    console.error('[agentic-recall] Warning: OMEGA not found. Memory features disabled.');
    console.error('[agentic-recall] Install with: pip install omega-memory');
  }

  process.exit(0);
}

main();
```

### 4. `adapters/claude-code/hooks.json`

The hooks config users copy to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentic-recall/dist/adapters/claude-code/recall.js",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentic-recall/dist/adapters/claude-code/capture.js",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/agentic-recall/dist/adapters/claude-code/init.js",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

### 5. `adapters/claude-code/install.sh`

One-command installer that wires the hooks into the user's Claude Code settings:

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RECALL_PATH="$SCRIPT_DIR/../../dist/adapters/claude-code/recall.js"
CAPTURE_PATH="$SCRIPT_DIR/../../dist/adapters/claude-code/capture.js"
INIT_PATH="$SCRIPT_DIR/../../dist/adapters/claude-code/init.js"

# Build if not already built
if [ ! -f "$RECALL_PATH" ]; then
  echo "Building agentic-recall..."
  cd "$SCRIPT_DIR/../.."
  npm run build
fi

# Generate hooks config with absolute paths
cat > /tmp/agentic-recall-hooks.json << EOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $RECALL_PATH",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $CAPTURE_PATH",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $INIT_PATH",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
EOF

# Merge into user settings
SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"

if [ -f "$SETTINGS_FILE" ]; then
  # Merge hooks into existing settings
  jq -s '.[0] * .[1]' "$SETTINGS_FILE" /tmp/agentic-recall-hooks.json > /tmp/merged-settings.json
  mv /tmp/merged-settings.json "$SETTINGS_FILE"
else
  cp /tmp/agentic-recall-hooks.json "$SETTINGS_FILE"
fi

rm /tmp/agentic-recall-hooks.json

echo "✅ agentic-recall hooks installed to $SETTINGS_FILE"
echo "   Recall: UserPromptSubmit → $RECALL_PATH"
echo "   Capture: Stop → $CAPTURE_PATH"
echo "   Init: SessionStart → $INIT_PATH"
echo ""
echo "Restart Claude Code to activate."
```

## Core Changes Needed

The existing core modules need minor adjustments to work from both adapters:

### `core/omega-client.ts`
- `query(text, limit?)` — already exists, no changes needed
- `store(content, type, metadata?)` — already exists, no changes needed
- Both should use environment variable `AGENTIC_RECALL_DB_PATH` to allow per-project memory isolation

### `core/config.ts`
- Add support for loading config from environment variables (Claude Code doesn't have a plugin config system):
  - `AGENTIC_RECALL_AUTO_RECALL=true`
  - `AGENTIC_RECALL_AUTO_CAPTURE=true`
  - `AGENTIC_RECALL_MAX_RESULTS=10`
  - `AGENTIC_RECALL_MIN_SCORE=0.3`
  - `AGENTIC_RECALL_CAPTURE_MODE=all`
  - `AGENTIC_RECALL_DUAL_SAVE=true`
  - `AGENTIC_RECALL_DEBUG=false`
- Fall back to defaults if no env vars set

### `core/sanitize.ts`
- Add stripping of `=== RELEVANT MEMORIES ===` ... `=== END MEMORIES ===` blocks (prevent memory injection from being re-captured)
- This may already exist from the OpenClaw adapter — verify

## tsconfig.json Changes

Ensure the adapter files are included in compilation:
```json
{
  "include": ["core/**/*", "adapters/**/*", "tools/**/*", "lib/**/*", "hooks/**/*"]
}
```

## package.json Changes

Add a `bin` entry for the install script:
```json
{
  "scripts": {
    "install:claude-code": "bash adapters/claude-code/install.sh"
  }
}
```

## Testing

### Unit tests for adapter scripts:
```bash
# Test recall hook
echo '{"hook_event_name":"UserPromptSubmit","prompt":"set up database","session_id":"test","transcript_path":"/tmp/test.jsonl","cwd":"/tmp","permission_mode":"default"}' | node dist/adapters/claude-code/recall.js
# Should output JSON with additionalContext if OMEGA has relevant memories

# Test capture hook (needs a transcript file)
echo '{"hook_event_name":"Stop","stop_hook_active":false,"session_id":"test","transcript_path":"/tmp/test-transcript.jsonl","permission_mode":"default"}' | node dist/adapters/claude-code/capture.js
# Should exit 0 silently after storing to OMEGA

# Test stop_hook_active guard
echo '{"hook_event_name":"Stop","stop_hook_active":true,"session_id":"test","transcript_path":"/tmp/test.jsonl","permission_mode":"default"}' | node dist/adapters/claude-code/capture.js
echo $?  # Should be 0 immediately
```

### Integration test:
1. Install hooks via `npm run install:claude-code`
2. Start Claude Code session
3. Have a conversation with decisions ("Let's use Redis for caching")
4. End the session
5. Start a new session
6. Ask about caching — should see injected memory about Redis decision

## Build Command for Claude Code

```
Read this spec file (adapters/claude-code/SPEC.md). Then:
1. Create adapters/claude-code/recall.ts, capture.ts, init.ts, install.sh, and hooks.json
2. Update core/config.ts to support environment variable configuration
3. Verify core/sanitize.ts strips memory injection markers
4. Update tsconfig.json to include adapters/
5. Add install:claude-code script to package.json
6. Write tests in tests/adapters/claude-code/
7. Build and verify TypeScript compiles
8. Run the unit tests

Use the existing core modules — do NOT duplicate logic. The adapter is a thin bridge between Claude Code's hook JSON protocol and the shared core.
```
