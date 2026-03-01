# agentic-recall

**Persistent, implicit memory for AI coding agents. No cloud. No manual notes. No tool calls. It just remembers.**

---

## Two Great Ideas, One Missing Piece

Two open-source projects each solved half the memory problem for AI agents — but neither could solve it alone.

**[Supermemory](https://github.com/supermemoryai/openclaw-supermemory)** nailed the UX. It figured out that memory should be *implicit* — captured and recalled automatically through lifecycle hooks, not through explicit tool calls the agent has to decide to make. When memory is a tool, agents forget to use it. When memory is a hook, it just works. Brilliant pattern. One problem: it requires a $20/month proprietary cloud API for the actual storage and retrieval. Your memories live on someone else's server.

**[OMEGA](https://github.com/omega-memory/omega-memory)** nailed the engine. Local-first SQLite database with ONNX embeddings, semantic search, contradiction detection, time-decay scoring, typed memory categories, and graph relationships between memories. Everything runs on your machine. One problem: it's tool-based — the agent has to *choose* to call `remember()` and `recall()`. In practice, agents often don't.

**agentic-recall** takes Supermemory's hook-based implicit capture/recall pattern and wires it to OMEGA's local-first intelligent memory engine. The result: memory that captures and recalls automatically on every turn, backed by a sophisticated local engine, with zero cloud dependency.

| Capability | Supermemory | OMEGA | **agentic-recall** |
|------------|------------|-------|--------------------|
| Implicit capture (no agent decision) | ✅ Hook-based | ❌ Tool-based | ✅ |
| Implicit recall (no agent decision) | ✅ Hook-based | ❌ Tool-based | ✅ |
| Fully local / no cloud | ❌ $20/mo cloud API | ✅ SQLite + ONNX | ✅ |
| Contradiction detection | ❌ | ✅ | ✅ |
| Time-decay with floor | ❌ | ✅ | ✅ |
| Typed memories | ❌ | ✅ | ✅ |
| Graph relationships | ❌ | ✅ Typed edges | ✅ |
| Raw chunk fallback | ✅ | ❌ | ✅ |
| Open source engine | ❌ Proprietary API | ✅ Apache-2.0 | ✅ |

Neither project needed to change. They just needed each other.

---

## The Problem

Every AI coding agent has the same fatal flaw: **amnesia**.

- **Mid-session:** Context compacts. The agent forgets what you decided 20 minutes ago.
- **Cross-session:** Close the terminal, come back tomorrow. Blank slate.
- **Accumulated knowledge:** That bug you spent 4 hours debugging last week? The architecture decision you made with careful reasoning? Gone.

The workarounds all have gaps:

| Approach | Gap |
|----------|-----|
| `CLAUDE.md` / notes files | Manual — you forget to update them, especially after frustrating sessions |
| MCP memory servers | Agent must *choose* to call `remember()` — it often doesn't |
| Chat history search | String matching, no semantic understanding |
| Progress files | Manual checkpoint, captures what *you* thought mattered, not what the agent needs |

The core insight from Supermemory's design: **if the agent has to decide to remember, it won't**. Memory has to be invisible — captured and recalled through hooks that fire on every turn, not tools the agent might skip.

---

## How It Works

### Capture (after every agent response)

```
You: "Let's use PostgreSQL instead of MongoDB — we need ACID for payments."
Agent: "Good call. I'll update the schema..."

→ Hook fires automatically
→ Classified as: decision (confidence: 0.92)
→ Stored in OMEGA: "Chose PostgreSQL over MongoDB for orders service — need ACID for payments"
→ Raw conversation chunk also stored as fallback
```

### Recall (before every agent response)

```
You: "Set up the database connection for the orders service"

→ Hook fires automatically
→ Semantic search finds relevant memories
→ Injected into agent context:

  === RELEVANT MEMORIES (auto-recalled) ===

  [decision | 2 hours ago | score: 0.87 | accessed: 3x]
  Chose PostgreSQL over MongoDB for orders service — need ACID for payments.

  [user_preference | 3 days ago | score: 0.82 | accessed: 7x]
  Always use early returns. Never nest more than 2 levels.

  === END MEMORIES ===

→ Agent responds knowing the decision without you repeating it
```

### Content Classification

Every captured turn is classified locally using pattern matching — no LLM call needed:

| Type | Triggered By | Example |
|------|-------------|---------|
| `decision` | "we chose", "let's go with", "decided to" | "Chose PostgreSQL over MongoDB for ACID compliance" |
| `lesson` | "the fix was", "root cause", "turned out" | "ECONNRESET was connection pool exhaustion — set maxSockets=50" |
| `user_preference` | "always use", "never", "prefer" | "Always use early returns, max 2 nesting levels" |
| `error_pattern` | "bug was", "error:", "fixed by" | "Jest mock not clearing — need jest.restoreAllMocks() in afterEach" |
| `general` | Default fallback | Conversation context without a specific signal |

### Dual-Save Strategy

Every captured turn stores two things (ported from Supermemory's approach):

1. **Extracted fact** — classified and condensed (e.g., "Chose PostgreSQL for ACID compliance")
2. **Raw chunk** — full sanitized conversation turn as fallback

Semantic search hits the concise fact for precision. The raw chunk preserves nuance when the extraction misses something.

### Fail-Open Design

Memory should never break your workflow:

- OMEGA unreachable → Log warning, continue without memory
- Classification fails → Default to `general` type
- Recall returns nothing → Agent proceeds normally
- Capture errors → Skip silently, never block the agent

---

## Platform Support

The core memory logic is platform-agnostic. Thin adapter layers wire it into each runtime:

| Platform | Hook Mechanism | Status |
|----------|---------------|--------|
| **OpenClaw** | `before_agent_start` / `agent_end` lifecycle hooks | ✅ Built |
| **Claude Code** | `PreToolUse` / `PostToolUse` / `Stop` hooks (stdin/stdout JSON) | 🚧 Coming |

One codebase, two entry points. The adapter layer is ~50 lines per platform — everything else is shared.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│            Agent Runtime (OpenClaw or Claude Code)         │
│                                                            │
│  ┌─────────────┐              ┌─────────────────────────┐ │
│  │   Agent      │── events ──▶│  agentic-recall          │ │
│  │   Loop       │◀─ inject ──│                           │ │
│  └─────────────┘              │  core/                   │ │
│                                │    classifier.ts         │ │
│                                │    omega-client.ts       │ │
│                                │    formatter.ts          │ │
│                                │                          │ │
│                                │  adapters/               │ │
│                                │    openclaw/  claude-code/│ │
│                                └──────────┬──────────────┘ │
└───────────────────────────────────────────┼────────────────┘
                                            │ Python subprocess
                                            │ (Phase 2: UDS socket)
                               ┌────────────▼────────────┐
                               │   OMEGA Python Engine     │
                               │                           │
                               │  SQLite + ONNX embeddings │
                               │  Contradiction detection  │
                               │  Time-decay + typed memory│
                               │  Graph relationships      │
                               └───────────────────────────┘
```

### Bridge: TypeScript → Python

OMEGA is Python. The plugin is TypeScript. The bridge has two phases:

| Phase | Approach | Latency | Status |
|-------|----------|---------|--------|
| **MVP** | Shell out to `python3 -c "from omega import ..."` | ~200ms | ✅ Built |
| **Phase 2** | UDS socket to OMEGA daemon | ~5ms | Planned |

Phase 2 connects directly to OMEGA's existing daemon socket — no new infrastructure needed.

---

## Installation

### Prerequisites

- Node.js 18+
- Python 3.10+
- OMEGA memory engine: `pip install omega-memory`

### OpenClaw

```bash
git clone https://github.com/somedumbguy/agentic-recall
cd agentic-recall
npm install
npm run build
```

### Claude Code (coming soon)

```bash
# Copy hook config to your project
cp adapters/claude-code/hooks.json .claude/settings.local.json

# Hooks fire automatically on every turn
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoRecall` | boolean | `true` | Inject relevant memories before each turn |
| `autoCapture` | boolean | `true` | Store conversation after each turn |
| `maxRecallResults` | number | `10` | Max memories injected per turn |
| `recallMinScore` | number | `0.3` | Minimum similarity score threshold |
| `profileFrequency` | number | `50` | Include full user profile every N turns |
| `captureMode` | string | `"all"` | `"all"` = every turn, `"smart"` = only meaningful turns |
| `captureMinLength` | number | `20` | Skip trivial exchanges ("ok", "sure") |
| `dualSave` | boolean | `true` | Store both extracted facts and raw chunks |
| `debug` | boolean | `false` | Verbose logging |

---

## Project Structure

```
agentic-recall/
├── core/                    # Platform-agnostic memory logic (shared)
│   ├── omega-client.ts      # Python bridge (subprocess / UDS)
│   ├── classifier.ts        # Rule-based content type classification
│   ├── formatter.ts         # Memory formatting for context injection
│   ├── profile.ts           # User profile aggregation
│   └── types.ts             # Shared TypeScript types
├── adapters/
│   ├── openclaw/            # OpenClaw lifecycle hook wiring
│   │   ├── recall.ts        # before_agent_start → core recall
│   │   ├── capture.ts       # agent_end → core capture
│   │   └── plugin.json      # OpenClaw plugin manifest
│   └── claude-code/         # Claude Code hook wiring (coming)
│       ├── recall.sh        # PreToolUse stdin/stdout bridge
│       ├── capture.sh       # PostToolUse stdin/stdout bridge
│       └── hooks.json       # Claude Code hook config
├── tools/                   # Explicit agent tools (search, store, forget, profile)
├── lib/                     # Utilities (validation, sanitization, logging)
├── tests/                   # Unit + integration tests
├── omega-hooks-prd.md       # Full build specification
├── CLAUDE.md                # Project context for AI-assisted development
└── claude-progress.txt      # Build progress tracker
```

---

## How It Was Built

This plugin was built autonomously by Claude Code in a single session.

The build spec (`omega-hooks-prd.md`) was written collaboratively in a prior session — analyzing both Supermemory and OMEGA's source code, mapping their APIs, and designing the integration layer. That spec was then fed to Claude Code with a single autonomous prompt using:

- **Ralph Wiggum** — autonomous loop plugin that kept Claude Code iterating through all build tasks without human intervention
- **Effective Harnesses pattern** — `claude-progress.txt` + git commits as breadcrumbs surviving context compaction
- **Custom subagents** — `reference-reader` (studied Supermemory/OMEGA source), `test-runner` (isolated test execution), `integration-tester` (OMEGA bridge verification)
- **Context7 MCP** — live library documentation instead of hallucinated APIs

The full research and methodology is documented in the repo.

---

## Roadmap

- [x] Core memory engine integration (OMEGA bridge via subprocess)
- [x] Rule-based content classifier (5 memory types)
- [x] Auto-recall hook (OpenClaw adapter)
- [x] Auto-capture hook with dual-save (OpenClaw adapter)
- [x] Explicit tools (search, store, forget, profile)
- [x] Fail-open error handling throughout
- [ ] **Claude Code adapter** (PreToolUse / PostToolUse / Stop hooks)
- [ ] UDS socket bridge (Phase 2 — ~5ms vs ~200ms latency)
- [ ] MCP server mode (alternative integration path)
- [ ] Profile aggregation improvements
- [ ] Multi-project memory isolation

---

## Credits

Built by combining the best ideas from two projects:

- **[Supermemory](https://github.com/supermemoryai/openclaw-supermemory)** (MIT) — Pioneered hook-based implicit capture/recall. Proved that memory should be invisible, not a tool the agent decides to use.
- **[OMEGA](https://github.com/omega-memory/omega-memory)** (Apache-2.0) — Built the engine: local SQLite, ONNX embeddings, contradiction detection, time-decay, typed memory, graph relationships. Proved that memory can be sophisticated without a cloud.

## License

MIT
