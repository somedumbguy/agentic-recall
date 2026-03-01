# PRD: OMEGA-Hooks — Implicit Memory for OpenClaw via OMEGA Backend

## Product Spec & Implementation Plan for Claude Code

**Version:** 1.0  
**Date:** 2026-02-28  
**Status:** Ready for Implementation

---

## 1. Executive Summary

### What We're Building

An OpenClaw plugin called `openclaw-omega` that combines:

- **Supermemory's hook-based implicit capture/recall pattern** (the "when" and "how" of memory — MIT-licensed plugin code from `supermemoryai/openclaw-supermemory`)
- **OMEGA's local-first intelligent memory engine** (the "what" and "where" of memory — Apache-2.0 from `omega-memory/omega-memory`)

The result: an OpenClaw plugin where memory capture and recall happen automatically via lifecycle hooks (no agent tool-call decisions required), backed by OMEGA's local SQLite + ONNX embeddings with contradiction detection, time-decay, typed memory, and graph relationships. Zero cloud dependency.

### Why This Matters

| Problem | Supermemory Alone | OMEGA Alone | Combined |
|---------|-------------------|-------------|----------|
| Implicit capture (no agent decision) | ✅ Hook-based | ❌ Tool-based (agent must decide) | ✅ |
| Implicit recall (no agent decision) | ✅ Hook-based | ❌ Tool-based | ✅ |
| Fully local / no cloud | ❌ Requires $20/mo cloud API | ✅ SQLite + ONNX | ✅ |
| Contradiction detection | ❌ Cloud handles it opaquely | ✅ Transparent, auditable | ✅ |
| Time-decay with floor | ❌ Unknown | ✅ 0.35 floor, typed exemptions | ✅ |
| Checkpoint/resume | ❌ | ✅ | ✅ |
| Graph relationships | ❌ | ✅ Typed edges | ✅ |
| Raw chunk fallback | ✅ Saves extracted + raw | ❌ Extracted only | ✅ (new) |
| Open source engine | ❌ Proprietary cloud API | ✅ Apache-2.0 | ✅ |

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    OpenClaw Runtime                    │
│                                                        │
│  ┌─────────────┐    Events     ┌───────────────────┐  │
│  │   Agent      │──────────────▶│ openclaw-omega     │  │
│  │   Loop       │◀──────────────│ plugin             │  │
│  └─────────────┘  prependCtx   │                     │  │
│                                 │  hooks/             │  │
│                                 │    recall.ts ←──┐   │  │
│                                 │    capture.ts ──┤   │  │
│                                 │  tools/         │   │  │
│                                 │    search.ts    │   │  │
│                                 │    store.ts     │   │  │
│                                 │    forget.ts    │   │  │
│                                 │    profile.ts   │   │  │
│                                 │  lib/           │   │  │
│                                 │    omega-client  │   │  │
│                                 └────────┬────────┘  │
│                                          │            │
└──────────────────────────────────────────┼────────────┘
                                           │ Python subprocess
                                           │ or UDS socket
                              ┌────────────▼────────────┐
                              │   OMEGA Python Engine     │
                              │                           │
                              │  from omega import        │
                              │    store, query, remember │
                              │                           │
                              │  omega.db (SQLite)        │
                              │    memories | edges |     │
                              │    embeddings             │
                              │  bge-small-en-v1.5 ONNX  │
                              └───────────────────────────┘
```

### Key Design Decision: How TypeScript Plugin Talks to Python Engine

OMEGA is Python. OpenClaw plugins are TypeScript. Three options for the bridge:

| Approach | Latency | Complexity | Recommendation |
|----------|---------|------------|----------------|
| **A) Shell out to `omega` CLI** | ~200ms per call | Low | ✅ Start here (MVP) |
| **B) UDS socket to OMEGA daemon** | ~5ms per call | Medium | Phase 2 (OMEGA already has `fast_hook.py` → daemon) |
| **C) OMEGA MCP server over stdio** | ~10ms per call | Medium | Alternative if MCP already running |

**MVP uses Approach A**: spawn `python3 -c "from omega import store, query; ..."` or call `omega` CLI commands. This is how OMEGA's own hooks work (`fast_hook.py` dispatches to daemon UDS socket with fail-open semantics). We replicate the same pattern.

**Phase 2 upgrades to Approach B**: connect directly to OMEGA's daemon UDS socket from TypeScript using Node's `net.createConnection()`. OMEGA already runs a daemon that listens on a Unix Domain Socket — we just need to speak its protocol.

---

## 3. Source Code Reference (What to Study)

### Supermemory Plugin (MIT-licensed hooks to port)

**Repo:** `https://github.com/supermemoryai/openclaw-supermemory`

| File | Purpose | What to Extract |
|------|---------|-----------------|
| `index.ts` (L14-64) | Plugin registration, wires hooks + tools + commands | The `register(api)` pattern: `api.on("before_agent_start", ...)` and `api.on("agent_end", ...)` |
| `hooks/recall.ts` (L1-129) | **AUTO-RECALL**: queries memory before every agent turn | **Core pattern**: extract user prompt → query memories → deduplicate (L59-82) → format with timestamps/scores (L27-57) → `api.prependContext(formatted)` to inject into agent prompt |
| `hooks/capture.ts` (L1-96) | **AUTO-CAPTURE**: stores conversation after every agent turn | **Core pattern**: extract last user+assistant turn from conversation → sanitize (strip control chars, strip injected context markers) → validate length → send to storage with session metadata |
| `client.ts` (L1-143) | Supermemory API client (authenticated HTTP) | **Replace entirely** with OMEGA Python calls. Shows the API surface we need: `search(query, limit)`, `store(content, metadata)`, `delete(id)`, `getProfile()` |
| `config.ts` (L1-90) | Configuration parsing with defaults | Port the schema: `autoRecall`, `autoCapture`, `maxRecallResults`, `profileFrequency`, `captureMode`, `containerTag`, `debug` |
| `lib/validate.js` (L1-59) | Input sanitization and validation | Port directly: sanitize control characters (L20-43), validate content length (L44-50), validate API key format |
| `memory.ts` | Memory formatting/preparation | Format memories with relative timestamps ("2 hours ago"), similarity scores, profile sections |
| `tools/search.ts` | Explicit search tool for agent | Adapt to call `omega.query()` instead of Supermemory API |
| `tools/store.ts` | Explicit store tool for agent | Adapt to call `omega.store()` |
| `tools/forget.ts` | Explicit delete tool for agent | Adapt to call `omega.delete()` |
| `tools/profile.ts` | User profile retrieval tool | Build profile from OMEGA's typed memories (aggregate user_preference, decision, etc.) |
| `commands/slash.ts` | Slash commands: `/remember`, `/recall` | Port directly, swap backend calls |
| `commands/cli.ts` | CLI commands: `search`, `profile`, `wipe` | Port directly |

### OMEGA Engine (Apache-2.0 backend to use)

**Repo:** `https://github.com/omega-memory/omega-memory`

| Component | Purpose | Integration Point |
|-----------|---------|-------------------|
| `from omega import store, query, remember` | Core Python API | Called from TypeScript via subprocess/UDS |
| `omega.store(content, type)` | Store with typed memory (decision, lesson, user_preference, error_pattern) | Capture hook calls this |
| `omega.query(text)` | Semantic search with ranked results | Recall hook calls this |
| `hooks/fast_hook.py` | Dispatch hook events to daemon via UDS socket | Study for Phase 2 UDS integration |
| `src/omega/` | Full engine: embeddings, dedup, contradiction detection, decay, graph | Don't modify — use as library |
| `benchmarks/` | LongMemEval + MemoryStress benchmarks | Reference for testing |

### OpenClaw Plugin SDK (Integration surface)

**Docs:** `https://docs.openclaw.ai/concepts/memory`

| SDK Method | When | Purpose |
|------------|------|---------|
| `api.on("before_agent_start", handler)` | Before every agent turn | Recall hook fires here |
| `api.on("agent_end", handler)` | After every agent turn | Capture hook fires here |
| `api.registerTool(spec, handler, options)` | Plugin init | Register search/store/forget/profile tools |
| `api.registerSlashCommand(spec, handler)` | Plugin init | Register `/remember`, `/recall` |
| `api.registerCliCommand(spec, handler)` | Plugin init | Register `search`, `profile`, `wipe` |
| `api.registerService(lifecycle)` | Plugin init | Startup/shutdown hooks |
| `api.prependContext(text)` | In recall handler | Inject memories into agent prompt |
| `handler.conversation` | In capture handler | Access conversation history (user + assistant messages) |

---

## 4. Detailed Functional Spec

### 4.1 Auto-Recall Hook (`hooks/recall.ts`)

**Trigger:** `before_agent_start` event (fires before every agent response)

**Input:** The user's current prompt + conversation context

**Process:**

1. **Extract query text** from the user's latest message
2. **Call OMEGA `query()`** with the user's message text
   - CLI: `python3 -c "import json; from omega import query; print(json.dumps(query('user message text')))"`
   - Returns: array of `{ content, type, score, created_at, accessed_count, tags }`
3. **Call OMEGA for user profile** every N turns (configurable via `profileFrequency`, default 50)
   - Query with type filter: `query("user preferences", type="user_preference")`
   - Also pull recent `decision` and `error_pattern` types
4. **Deduplicate results** (port from Supermemory's `recall.ts` L59-82):
   - Remove memories with >90% content overlap
   - Prefer higher-scored results when deduplicating
5. **Format for injection** (port from Supermemory's `recall.ts` L27-57):
   ```
   === RELEVANT MEMORIES (auto-recalled) ===
   
   [decision | 2 hours ago | score: 0.87 | accessed: 3x]
   We chose PostgreSQL over MongoDB for orders service — need ACID for payments.
   
   [user_preference | 3 days ago | score: 0.82 | accessed: 7x]
   Always use early returns. Never nest more than 2 levels.
   
   [error_pattern | 1 week ago | score: 0.79 | accessed: 5x]
   ECONNRESET on API calls — connection pool exhaustion. Fix: maxSockets=50.
   
   === USER PROFILE ===
   (included every 50 turns)
   - Prefers TypeScript strict mode
   - Uses PostgreSQL for transactional services
   - Code style: early returns, max 2 nesting levels
   
   === END MEMORIES ===
   ```
6. **Inject via `api.prependContext(formatted)`**
7. **Strip previous injection markers** — if conversation already has `=== RELEVANT MEMORIES ===` from a prior turn, remove it before adding new ones (prevents stacking)

**Configuration:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoRecall` | boolean | `true` | Enable/disable auto-recall |
| `maxRecallResults` | number | `10` | Max memories injected per turn |
| `profileFrequency` | number | `50` | Include full profile every N turns |
| `recallMinScore` | number | `0.3` | Minimum similarity score to include |

**Error handling:** Fail-open. If OMEGA is unreachable or errors, log warning and continue without injecting memories. Agent functions normally, just without recall.

### 4.2 Auto-Capture Hook (`hooks/capture.ts`)

**Trigger:** `agent_end` event (fires after every agent response)

**Input:** The full conversation including the agent's latest response

**Process:**

1. **Extract the last turn** — the most recent user message + assistant response pair
2. **Sanitize content** (port from Supermemory's `validate.js` L20-43):
   - Strip control characters (except newlines/tabs)
   - Strip injected context markers (`=== RELEVANT MEMORIES ===` ... `=== END MEMORIES ===`)
   - Strip any `[SYSTEM]` or `[CONTEXT]` prefixes
3. **Validate** (port from Supermemory's `validate.js` L44-50):
   - Skip if content is empty after sanitization
   - Skip if content is under 20 characters (trivial exchanges like "ok" / "sure")
   - Skip if content length exceeds 50,000 characters (likely file dumps, not conversation)
4. **Classify content type** — determine what kind of memory this is:
   - Look for decision signals: "we chose", "let's go with", "decided to", "the approach is"
   - Look for lesson signals: "the fix was", "turned out", "root cause", "learned that"
   - Look for preference signals: "always use", "never", "prefer", "my style"
   - Look for error signals: "bug was", "error:", "fixed by", "workaround:"
   - Default: `"general"` if no clear signal
5. **Dual-save to OMEGA** (this is a key innovation from Supermemory):
   - **Save A — Extracted facts**: Call OMEGA `store()` with the classified type and a condensed version of the key information
   - **Save B — Raw chunk**: Call OMEGA `store()` with type `"conversation_chunk"` and the full sanitized turn text. This serves as fallback when extracted facts miss nuance.
6. **Include session metadata**: session ID, timestamp, channel/container tag if custom containers enabled

**Configuration:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoCapture` | boolean | `true` | Enable/disable auto-capture |
| `captureMode` | string | `"all"` | `"all"` = every turn, `"smart"` = only turns with decision/lesson/preference signals |
| `captureMinLength` | number | `20` | Skip turns shorter than this |
| `captureMaxLength` | number | `50000` | Skip turns longer than this |
| `dualSave` | boolean | `true` | Save both extracted facts and raw chunks |

**Error handling:** Fail-open. If OMEGA errors on capture, log warning and continue. Never block the agent or user experience.

### 4.3 Content Classification (New Component: `lib/classifier.ts`)

This is a lightweight local classifier that determines memory type without calling an LLM. OMEGA supports typed memories (`decision`, `lesson`, `user_preference`, `error_pattern`, `general`). We need to classify incoming content.

**Implementation — Rule-Based (No LLM Required):**

```typescript
interface ClassificationResult {
  type: "decision" | "lesson" | "user_preference" | "error_pattern" | "general";
  confidence: number; // 0.0-1.0
  extractedFact: string; // condensed key information
}

function classify(userMessage: string, assistantMessage: string): ClassificationResult {
  const combined = `${userMessage}\n${assistantMessage}`.toLowerCase();
  
  // Decision patterns
  const decisionPatterns = [
    /we (?:chose|decided|went with|picked|selected)/,
    /(?:let's|lets) (?:go with|use|stick with)/,
    /(?:the|our) (?:approach|decision|choice) (?:is|was)/,
    /(?:going forward|from now on),? (?:we'll|we will)/,
  ];
  
  // Lesson / debugging patterns
  const lessonPatterns = [
    /(?:the |root )?(?:fix|cause|issue|problem|bug) (?:was|is|turned out)/,
    /(?:learned|discovered|realized|found out) that/,
    /(?:turns out|it was because|the reason was)/,
    /(?:workaround|solution|resolution):/i,
  ];
  
  // Preference patterns
  const preferencePatterns = [
    /(?:always|never|prefer|my style|i like to|i want you to)/,
    /(?:remember|from now on|going forward):?\s/,
    /(?:code style|convention|standard|rule):/i,
  ];
  
  // Error patterns  
  const errorPatterns = [
    /(?:error|exception|crash|failure|bug|broke):/i,
    /(?:stack trace|traceback|stderr)/i,
    /(?:ECONNRESET|ENOMEM|EACCES|ENOENT|SIGKILL)/,
    /(?:fixed by|resolved by|patched with)/,
  ];
  
  // Score each type, return highest
  // ... (pattern matching with confidence scores)
}
```

### 4.4 Explicit Tools (Agent-Callable)

These are fallback tools the agent CAN invoke explicitly, beyond what auto-capture/recall handles.

#### `omega_search` Tool

```typescript
{
  name: "omega_search",
  label: "Memory Search",
  description: "Search long-term memory for relevant information. Use when the auto-recalled memories don't contain what you need.",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    type: { type: "string", description: "Filter by memory type", enum: ["decision","lesson","user_preference","error_pattern","general","conversation_chunk"] },
    limit: { type: "number", description: "Max results", default: 5 }
  }
}
```

Handler calls: `python3 -c "from omega import query; ..."`

#### `omega_store` Tool

```typescript
{
  name: "omega_store",
  label: "Memory Store",
  description: "Explicitly store something in long-term memory. Use when the user says 'remember this' or you want to save an important decision/lesson.",
  parameters: {
    content: { type: "string", description: "What to remember", required: true },
    type: { type: "string", description: "Memory type", enum: ["decision","lesson","user_preference","error_pattern","general"], default: "general" }
  }
}
```

Handler calls: `python3 -c "from omega import store; ..."`

#### `omega_forget` Tool

```typescript
{
  name: "omega_forget",
  label: "Memory Forget",
  description: "Delete a specific memory by ID or search query. Use when information is outdated or the user asks you to forget something.",
  parameters: {
    memoryId: { type: "string", description: "Specific memory ID to delete" },
    query: { type: "string", description: "Search query to find and delete matching memory" }
  }
}
```

#### `omega_profile` Tool

```typescript
{
  name: "omega_profile", 
  label: "User Profile",
  description: "Retrieve the user's accumulated profile — preferences, common patterns, and key decisions.",
  parameters: {}
}
```

Handler: queries OMEGA for all `user_preference` type memories + top `decision` and `error_pattern` entries, formats as a readable profile summary.

### 4.5 Slash Commands

| Command | Action |
|---------|--------|
| `/remember <text>` | Store text as a memory (auto-classifies type) |
| `/recall <query>` | Search memories and display results |

### 4.6 CLI Commands

| Command | Action |
|---------|--------|
| `openclaw omega status` | Show config, memory count, DB size |
| `openclaw omega search <query>` | Search memories from terminal |
| `openclaw omega profile` | Display user profile |
| `openclaw omega wipe` | Delete all memories (requires confirmation) |
| `openclaw omega stats` | Show memory statistics: count by type, total size, oldest/newest |
| `openclaw omega doctor` | Verify OMEGA installation, DB health, embedding model loaded |

---

## 5. Configuration Schema

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-omega": {
        "enabled": true,
        "config": {
          // OMEGA connection
          "omegaPath": "omega",           // Path to omega CLI (auto-detected)
          "pythonPath": "python3",         // Path to python3 (auto-detected)
          "dbPath": "~/.omega/omega.db",   // OMEGA database path
          "connectionMode": "cli",         // "cli" (MVP) or "uds" (Phase 2)
          "udsSocketPath": "",             // UDS socket path (Phase 2)
          
          // Auto-recall
          "autoRecall": true,
          "maxRecallResults": 10,
          "profileFrequency": 50,
          "recallMinScore": 0.3,
          
          // Auto-capture
          "autoCapture": true,
          "captureMode": "all",            // "all" | "smart"
          "captureMinLength": 20,
          "captureMaxLength": 50000,
          "dualSave": true,                // Save extracted facts + raw chunks
          
          // Containers (from Supermemory)
          "containerTag": "openclaw_default",
          "enableCustomContainerTags": false,
          "customContainers": [],
          "customContainerInstructions": "",
          
          // Debug
          "debug": false
        }
      }
    }
  }
}
```

---

## 6. OMEGA Python Bridge (`lib/omega-client.ts`)

This is the core bridge between TypeScript and Python. It must be robust and fail-open.

```typescript
// lib/omega-client.ts

interface OmegaMemory {
  id: string;
  content: string;
  type: string;
  score: number;
  created_at: string;
  accessed_count: number;
  tags: string[];
  edges?: { type: string; target_id: string }[];
}

interface OmegaClient {
  query(text: string, options?: { type?: string; limit?: number }): Promise<OmegaMemory[]>;
  store(content: string, type: string, metadata?: Record<string, any>): Promise<{ id: string }>;
  delete(id: string): Promise<{ deleted: boolean }>;
  getProfile(): Promise<OmegaMemory[]>;
  health(): Promise<{ ok: boolean; memoryCount: number; dbSize: string }>;
}
```

### MVP Implementation (CLI Subprocess)

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
const exec = promisify(execFile);

async function queryOmega(text: string, limit: number = 10): Promise<OmegaMemory[]> {
  const script = `
import json, sys
from omega import query
results = query(${JSON.stringify(text)}, limit=${limit})
print(json.dumps([{
  'id': r.id, 'content': r.content, 'type': r.type,
  'score': r.score, 'created_at': str(r.created_at),
  'accessed_count': r.accessed_count, 'tags': r.tags or []
} for r in results]))
`;
  try {
    const { stdout } = await exec('python3', ['-c', script], { timeout: 5000 });
    return JSON.parse(stdout.trim());
  } catch (err) {
    logger.warn('OMEGA query failed, continuing without recall:', err.message);
    return []; // fail-open
  }
}
```

### Phase 2 Implementation (UDS Socket)

```typescript
import * as net from 'net';

// Connect to OMEGA's daemon UDS socket (same one fast_hook.py uses)
async function queryOmegaUDS(text: string): Promise<OmegaMemory[]> {
  const socket = net.createConnection({ path: config.udsSocketPath });
  // Send JSON-RPC style request
  // OMEGA daemon already speaks this protocol for fast_hook.py
  const request = JSON.stringify({ method: 'query', params: { text, limit: 10 } });
  // ... read response, parse JSON
}
```

---

## 7. Implementation Plan (Phased)

### Phase 1: MVP — Working Plugin with CLI Bridge (Est: 2-3 days)

**Goal:** Functional OpenClaw plugin with auto-recall + auto-capture via OMEGA CLI.

#### Task 1.1: Project Scaffolding
- [ ] Create `openclaw-omega/` directory with TypeScript project
- [ ] `package.json` with `@types/node`, `typescript`, build scripts
- [ ] `openclaw.plugin.json` with plugin metadata (id: `openclaw-omega`, kind: `memory`)
- [ ] `tsconfig.json`
- [ ] `biome.json` for linting (match Supermemory's setup)

#### Task 1.2: Configuration System (`config.ts`)
- [ ] Define `OmegaConfig` interface with all options from Section 5
- [ ] Implement `parseConfig()` with environment variable resolution
- [ ] Defaults for all optional fields
- [ ] Validation: check `omegaPath` exists, python3 available, OMEGA installed
- [ ] Export config schema as JSON Schema for OpenClaw plugin system

#### Task 1.3: OMEGA Client Bridge (`lib/omega-client.ts`)
- [ ] Implement `OmegaClient` interface (Section 6)
- [ ] `query()` — subprocess call to `python3 -c "from omega import query; ..."`
- [ ] `store()` — subprocess call to `python3 -c "from omega import store; ..."`
- [ ] `delete()` — subprocess call using OMEGA's delete API
- [ ] `getProfile()` — query with type filter for user_preference + decision
- [ ] `health()` — call `omega doctor --json` or similar
- [ ] All methods: 5-second timeout, fail-open (return empty/false on error)
- [ ] Debug logging when `config.debug` is true

#### Task 1.4: Input Validation (`lib/validate.ts`)
- [ ] Port `sanitizeContent()` from Supermemory's `validate.js` L20-43
- [ ] Port `validateContent()` from Supermemory's `validate.js` L44-50
- [ ] Add `stripInjectedContext()` — remove `=== RELEVANT MEMORIES ===` blocks
- [ ] Add `stripSystemPrefixes()` — remove `[SYSTEM]`, `[CONTEXT]` markers

#### Task 1.5: Content Classifier (`lib/classifier.ts`)
- [ ] Implement rule-based classifier (Section 4.3)
- [ ] Pattern sets for decision, lesson, user_preference, error_pattern
- [ ] `classify(userMessage, assistantMessage)` returns `{ type, confidence, extractedFact }`
- [ ] Unit tests for each classification type

#### Task 1.6: Auto-Recall Hook (`hooks/recall.ts`)
- [ ] Register on `before_agent_start` event
- [ ] Extract user's latest message text
- [ ] Call `omegaClient.query()` with message text
- [ ] Every N turns (profileFrequency), also call `omegaClient.getProfile()`
- [ ] Deduplicate results (>90% content overlap removal)
- [ ] Format memories with type badges, relative timestamps, scores, access counts
- [ ] Call `api.prependContext()` with formatted block
- [ ] Handle config: `autoRecall`, `maxRecallResults`, `recallMinScore`
- [ ] Fail-open: catch all errors, log warning, continue without injection

#### Task 1.7: Auto-Capture Hook (`hooks/capture.ts`)
- [ ] Register on `agent_end` event
- [ ] Extract last user + assistant turn from conversation
- [ ] Sanitize (strip control chars, injected context markers, system prefixes)
- [ ] Validate (length checks, empty checks)
- [ ] Classify content type via `classifier.classify()`
- [ ] If `dualSave` enabled:
  - Store extracted fact with classified type
  - Store raw sanitized turn as `conversation_chunk`
- [ ] If `captureMode` is `"smart"`, only store if classifier confidence > 0.5
- [ ] Include session metadata (session ID, timestamp, container tag)
- [ ] Fail-open: catch all errors, log warning

#### Task 1.8: Plugin Registration (`index.ts`)
- [ ] Export default plugin object with metadata, config schema, register function
- [ ] In `register(api)`:
  - Parse and validate config
  - Create OmegaClient instance
  - Register recall hook (`api.on("before_agent_start", recallHandler)`)
  - Register capture hook (`api.on("agent_end", captureHandler)`)
  - Register 4 tools (search, store, forget, profile)
  - Register slash commands (`/remember`, `/recall`)
  - Register CLI commands (`status`, `search`, `profile`, `wipe`, `stats`, `doctor`)
  - Register service lifecycle (startup: check OMEGA health, shutdown: log stats)

#### Task 1.9: Explicit Tools (`tools/`)
- [ ] `tools/search.ts` — `omega_search` tool handler
- [ ] `tools/store.ts` — `omega_store` tool handler
- [ ] `tools/forget.ts` — `omega_forget` tool handler (search-then-delete pattern)
- [ ] `tools/profile.ts` — `omega_profile` tool handler

#### Task 1.10: Commands
- [ ] `commands/slash.ts` — `/remember` and `/recall` slash commands
- [ ] `commands/cli.ts` — `status`, `search`, `profile`, `wipe`, `stats`, `doctor`

#### Task 1.11: Testing
- [ ] Unit tests for classifier (each type + edge cases)
- [ ] Unit tests for validation/sanitization
- [ ] Unit tests for memory formatting
- [ ] Integration test: recall hook with mocked OMEGA client
- [ ] Integration test: capture hook with mocked OMEGA client
- [ ] End-to-end test: install plugin, send message, verify capture, send another message, verify recall

---

### Phase 2: Performance — UDS Socket Bridge (Est: 1-2 days)

**Goal:** Replace CLI subprocess calls with direct UDS socket connection to OMEGA daemon.

#### Task 2.1: Study OMEGA Daemon Protocol
- [ ] Read `omega-memory/hooks/fast_hook.py` to understand UDS message format
- [ ] Read OMEGA's daemon source (likely in `src/omega/daemon.py` or similar)
- [ ] Document the JSON-RPC or custom protocol used
- [ ] Verify daemon auto-starts when OMEGA is installed

#### Task 2.2: UDS Client Implementation
- [ ] Implement `OmegaUDSClient` class using Node.js `net` module
- [ ] Connection pooling (keep socket open between calls)
- [ ] Reconnection logic (if daemon restarts)
- [ ] Fallback to CLI mode if UDS fails
- [ ] Latency logging for comparison

#### Task 2.3: Configuration Toggle
- [ ] `connectionMode: "uds"` in config
- [ ] Auto-detect: try UDS first, fall back to CLI
- [ ] Health check via UDS

---

### Phase 3: Enhanced Intelligence (Est: 2-3 days)

**Goal:** Add features that go beyond either project alone.

#### Task 3.1: Contradiction Detection on Capture
- [ ] When storing a new memory, also query for potentially contradicting memories
- [ ] If OMEGA returns contradiction edges, format and log them
- [ ] Optionally surface contradictions to the user: "Note: this contradicts an earlier memory where you said X"

#### Task 3.2: Memory Container Routing
- [ ] Port Supermemory's custom container logic
- [ ] Map container tags to OMEGA's tag system
- [ ] Use channel/context to auto-route (work vs personal)
- [ ] Include `customContainerInstructions` in tool descriptions for agent

#### Task 3.3: Checkpoint/Resume Integration
- [ ] When OMEGA has an active checkpoint, surface it at session start
- [ ] Include checkpoint status in recall: "You have an unfinished task: migrating auth middleware..."
- [ ] Register a `/checkpoint` slash command that calls `omega.store()` with type `checkpoint`

#### Task 3.4: Pre-Compaction Memory Flush
- [ ] Integrate with OpenClaw's `compaction.memoryFlush` system
- [ ] Before compaction: extract key facts from conversation being compacted
- [ ] Store extracted facts in OMEGA (not just MEMORY.md)
- [ ] Ensures memory survives context compaction

#### Task 3.5: Raw Chunk Retrieval Fallback
- [ ] When extracted-fact recall doesn't answer the question well (low scores), also query `conversation_chunk` types
- [ ] Present raw chunks as "Here's the full conversation context" below the extracted facts
- [ ] Configurable: `dualRecall: true/false`

---

### Phase 4: Production Hardening (Est: 1-2 days)

#### Task 4.1: Benchmarking
- [ ] Run LongMemEval with the plugin (compare to OMEGA standalone score of 95.4%)
- [ ] Run MemoryStress (1,000 sessions) to measure degradation
- [ ] Measure recall latency (target: <300ms for CLI, <50ms for UDS)
- [ ] Measure capture latency (should be non-blocking, under 500ms)

#### Task 4.2: Memory Management
- [ ] Implement `omega wipe` with confirmation prompt
- [ ] Implement memory export (dump to JSON/markdown)
- [ ] Implement memory import (from another OMEGA instance)
- [ ] Size monitoring: warn if DB exceeds configurable threshold

#### Task 4.3: Documentation
- [ ] README.md with setup instructions
- [ ] ARCHITECTURE.md explaining the hook pattern
- [ ] CONFIGURATION.md with all options documented
- [ ] CONTRIBUTING.md
- [ ] License file (MIT for plugin code, note Apache-2.0 for OMEGA dependency)

---

## 8. File Structure

```
openclaw-omega/
├── package.json
├── tsconfig.json
├── biome.json
├── openclaw.plugin.json          # Plugin manifest
├── README.md
├── LICENSE                        # MIT
│
├── index.ts                       # Plugin entry: registration, wiring
├── config.ts                      # Config parsing, defaults, validation
├── logger.ts                      # Debug logger
│
├── hooks/
│   ├── recall.ts                  # before_agent_start → query OMEGA → inject context
│   └── capture.ts                 # agent_end → classify → store in OMEGA
│
├── tools/
│   ├── search.ts                  # omega_search tool
│   ├── store.ts                   # omega_store tool
│   ├── forget.ts                  # omega_forget tool
│   └── profile.ts                 # omega_profile tool
│
├── commands/
│   ├── slash.ts                   # /remember, /recall
│   └── cli.ts                     # status, search, profile, wipe, stats, doctor
│
├── lib/
│   ├── omega-client.ts            # TypeScript → Python bridge (CLI + UDS)
│   ├── validate.ts                # Input sanitization and validation
│   ├── classifier.ts              # Content type classifier (rule-based)
│   ├── formatter.ts               # Memory formatting for context injection
│   └── dedup.ts                   # Memory deduplication for recall results
│
├── types/
│   └── index.ts                   # TypeScript interfaces (OmegaMemory, OmegaConfig, etc.)
│
└── tests/
    ├── classifier.test.ts
    ├── validate.test.ts
    ├── formatter.test.ts
    ├── dedup.test.ts
    ├── recall.test.ts
    ├── capture.test.ts
    └── omega-client.test.ts
```

---

## 9. Prerequisites for Building

Before starting, Claude Code should:

1. **Clone both repos for reference:**
   ```bash
   git clone https://github.com/supermemoryai/openclaw-supermemory.git /tmp/supermemory-ref
   git clone https://github.com/omega-memory/omega-memory.git /tmp/omega-ref
   ```

2. **Study key files in order:**
   - `/tmp/supermemory-ref/index.ts` — plugin registration pattern
   - `/tmp/supermemory-ref/hooks/recall.ts` — the recall hook to port
   - `/tmp/supermemory-ref/hooks/capture.ts` — the capture hook to port
   - `/tmp/supermemory-ref/client.ts` — the API surface to replace
   - `/tmp/supermemory-ref/lib/validate.js` — the validation to port
   - `/tmp/supermemory-ref/config.ts` — the config schema to extend
   - `/tmp/omega-ref/src/omega/` — the Python API surface
   - `/tmp/omega-ref/hooks/` — how OMEGA's own hooks work (fast_hook.py)

3. **Verify OMEGA is installed:**
   ```bash
   pip3 install omega-memory[server]
   omega setup
   omega doctor
   python3 -c "from omega import store, query; print('OMEGA OK')"
   ```

4. **Verify OpenClaw plugin development:**
   ```bash
   # Check OpenClaw is installed and plugins directory exists
   which openclaw
   ls ~/.openclaw/plugins/ 2>/dev/null || echo "Create plugins dir"
   ```

---

## 10. Success Criteria

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Auto-recall works | Memories surface without agent tool calls | Start session, verify `=== RELEVANT MEMORIES ===` block appears in agent context |
| Auto-capture works | Conversations stored automatically | Make a decision in conversation, start new session, verify it's recalled |
| Contradiction detection | Superseded memories flagged | Store "we use JWT", then "we switched to sessions", verify contradiction edge |
| Fail-open behavior | OMEGA failure doesn't break agent | Kill OMEGA process, verify agent still responds (just without memory) |
| Recall latency (CLI) | <500ms | Time the recall hook execution |
| Recall latency (UDS) | <50ms | Time the recall hook execution with UDS |
| Capture latency | <1000ms (non-blocking) | Time the capture hook execution |
| Type classification accuracy | >80% on test set | Create 50 labeled examples, run classifier, measure accuracy |
| Dual-save works | Both extracted facts and raw chunks stored | Query by type after capture, verify both exist |
| Wipe command works | All memories deleted on command | Run wipe, verify empty DB |
| Doctor command works | Reports OMEGA health accurately | Run doctor with OMEGA running and stopped, verify correct output |

---

## 11. Key Decisions & Rationale

**Q: Why not just use OMEGA's existing hooks directly?**  
A: OMEGA's hooks use Claude Code's hook system (`fast_hook.py` dispatched via `settings.json` hooks). OpenClaw has its own plugin lifecycle (`before_agent_start`, `agent_end`). We need to bridge OMEGA's intelligence into OpenClaw's hook system. The Supermemory plugin already solved this exact integration pattern — we're reusing their approach with OMEGA's backend.

**Q: Why TypeScript for the plugin if OMEGA is Python?**  
A: OpenClaw plugins must be TypeScript/JavaScript (npm packages). The bridge via subprocess or UDS socket is the standard pattern — OMEGA itself uses this pattern (`fast_hook.py` is a thin Python script that dispatches to the daemon).

**Q: Why rule-based classification instead of LLM-based?**  
A: Latency. The capture hook fires after every turn. Adding an LLM call would add 1-5 seconds per turn. Rule-based classification runs in <1ms. OMEGA's own intelligence layer (contradiction detection, dedup, decay) handles the heavy lifting once content is stored.

**Q: Why dual-save (extracted facts + raw chunks)?**  
A: This is Supermemory's innovation that OMEGA lacks. Extracted facts are great for targeted recall ("what did we decide about the database?") but miss nuance. Raw chunks preserve the full conversation context as fallback. Storage is cheap (SQLite), and OMEGA's decay system will naturally deprioritize old raw chunks over time.

**Q: Why MIT license for the plugin?**  
A: Supermemory's plugin code is MIT-licensed, so our derivative is MIT. OMEGA (Apache-2.0) is a runtime dependency, not embedded — same as any npm/pip package.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OMEGA Python process slow to start | Recall adds >500ms latency | Phase 2 UDS socket; also consider keeping Python process warm |
| OpenClaw plugin SDK changes | Plugin breaks | Pin to specific OpenClaw version; follow their plugin API changelog |
| OMEGA DB corruption | All memory lost | OMEGA has built-in backup/restore; add periodic backup in plugin lifecycle |
| Classifier misclassifies content | Wrong memory types stored | Fail-safe: store as "general" when confidence low; OMEGA's search is semantic so type is secondary to content |
| Context window bloat from injected memories | Agent performance degrades | Cap injected content to configurable max tokens; truncate oldest/lowest-scored memories first |
| OMEGA not installed | Plugin fails to initialize | Graceful degradation: disable auto-recall/capture, show helpful error in `doctor` command |
