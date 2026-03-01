# openclaw-omega

**Implicit memory for AI coding agents — powered by OMEGA's local-first memory engine.**

Stop re-explaining yourself. `openclaw-omega` gives your AI agent persistent, semantic memory that captures decisions, preferences, lessons, and errors *automatically* — no manual notes, no cloud dependencies, no agent tool-call decisions required.

---

## The Problem

Every AI coding agent has the same fatal flaw: **amnesia**.

- **Mid-session:** Context compacts. The agent forgets what you decided 20 minutes ago.
- **Cross-session:** Close the terminal, come back tomorrow. Blank slate.
- **Accumulated knowledge:** That bug you spent 4 hours debugging last week? Gone. The architecture decision you made with reasoning? Gone.

Current workarounds are all flawed:

| Approach | Problem |
|----------|---------|
| `CLAUDE.md` / notes files | Manual, lossy — you forget to update them |
| MCP memory servers | Agent must *choose* to call `remember()` (it often doesn't) |
| Chat history search | No semantic understanding, just string matching |
| Progress files | Manual checkpoint, doesn't capture the *why* |

## The Solution

`openclaw-omega` uses **lifecycle hooks** to capture and recall memories *implicitly* — meaning the agent never decides whether to remember something. It just happens, on every turn, in the background.

**Capture** (after every agent response):
```
You: "Let's use PostgreSQL instead of MongoDB — we need ACID for payments."
Agent: "Good call. I'll update the schema..."

→ Automatically classified as: decision (confidence: 0.92)
→ Stored: "Chose PostgreSQL over MongoDB for orders service — need ACID for payments"
→ Also stored: raw conversation chunk as fallback
```

**Recall** (before every agent response):
```
You: "Set up the database connection for the orders service"

→ Semantic search fires automatically
→ Injects into agent context:
  [decision | 2 hours ago | score: 0.87]
  Chose PostgreSQL over MongoDB for orders service — need ACID for payments.

→ Agent responds knowing the decision without you repeating it
```

## What Makes This Different

This plugin combines two open-source projects that are each incomplete alone:

| Capability | Supermemory (hooks) | OMEGA (engine) | **openclaw-omega** |
|------------|--------------------|-----------------|--------------------|
| Implicit capture (no agent decision) | ✅ | ❌ Tool-based | ✅ |
| Implicit recall (no agent decision) | ✅ | ❌ Tool-based | ✅ |
| Fully local / no cloud | ❌ $20/mo API | ✅ SQLite + ONNX | ✅ |
| Contradiction detection | ❌ | ✅ | ✅ |
| Time-decay with floor | ❌ | ✅ | ✅ |
| Typed memories | ❌ | ✅ | ✅ |
| Graph relationships | ❌ | ✅ | ✅ |
| Raw chunk fallback | ✅ | ❌ | ✅ |
| Open source engine | ❌ Proprietary | ✅ Apache-2.0 | ✅ |

**Supermemory** figured out the *when* and *how* — hook-based implicit capture/recall is the right UX pattern. But it requires a paid cloud API.

**OMEGA** figured out the *what* and *where* — local SQLite + ONNX embeddings with contradiction detection, time-decay, and typed memory. But it requires the agent to actively call tools.

We took the best of both.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Agent Runtime (OpenClaw / Claude Code) │
│                                                        │
│  ┌─────────────┐    Events     ┌───────────────────┐  │
│  │   Agent      │──────────────▶│ openclaw-omega     │  │
│  │   Loop       │◀──────────────│ plugin             │  │
│  └─────────────┘  inject ctx   │                     │  │
│                                 │  core/              │  │
│                                 │    classifier.ts    │  │
│                                 │    omega-client.ts  │  │
│                                 │    formatter.ts     │  │
│                                 │  adapters/          │  │
│                                 │    openclaw/        │  │
│                                 │    claude-code/     │  │
│                                 └────────┬────────┘  │
│                                          │            │
└──────────────────────────────────────────┼────────────┘
                                           │ Python subprocess / UDS socket
                              ┌────────────▼────────────┐
                              │   OMEGA Python Engine     │
                              │                           │
                              │  SQLite + ONNX embeddings │
                              │  Contradiction detection  │
                              │  Time-decay + typed memory│
                              │  Graph relationships      │
                              └───────────────────────────┘
```

## Platform Support

The core memory logic is platform-agnostic. Thin adapter layers wire it into each runtime:

| Platform | Adapter | Hook Mechanism | Status |
|----------|---------|---------------|--------|
| **OpenClaw** | `adapters/openclaw/` | `before_agent_start` / `agent_end` lifecycle hooks | ✅ Built |
| **Claude Code** | `adapters/claude-code/` | `PreToolUse` / `PostToolUse` / `Stop` hooks (stdin/stdout JSON) | 🚧 Coming |

One codebase, two entry points.

## How It Works

### Memory Types

Every captured turn is classified locally (no LLM call) using pattern matching:

| Type | Triggered By | Example |
|------|-------------|---------|
| `decision` | "we chose", "let's go with", "decided to" | "Chose PostgreSQL over MongoDB for ACID compliance" |
| `lesson` | "the fix was", "root cause", "turned out" | "ECONNRESET was from connection pool exhaustion — set maxSockets=50" |
| `user_preference` | "always use", "never", "prefer", "my style" | "Always use early returns, max 2 nesting levels" |
| `error_pattern` | "bug was", "error:", "fixed by" | "Jest mock not clearing — need jest.restoreAllMocks() in afterEach" |
| `general` | Default fallback | Conversation context that doesn't match a specific pattern |

### Fail-Open Design

Memory should never break your workflow. Every operation is fail-open:

- OMEGA unreachable? → Log warning, continue without memory.
- Classification fails? → Default to `general` type.
- Recall returns nothing? → Agent proceeds normally.
- Capture errors? → Skip silently, never block the agent.

### Dual-Save Strategy

Every captured turn stores two things (ported from Supermemory's approach):

1. **Extracted fact** — classified and condensed (e.g., "Chose PostgreSQL for ACID compliance")
2. **Raw chunk** — full sanitized conversation turn as fallback

This means semantic search hits the concise fact, but the full context is always available when nuance matters.

## Installation

### Prerequisites

- Node.js 18+
- Python 3.10+
- OMEGA memory engine: `pip install omega-memory`

### OpenClaw

```bash
# Install the plugin
openclaw plugin install openclaw-omega

# Or from source
git clone https://github.com/somedumbguy/openclaw-omega
cd openclaw-omega
npm install
npm run build
```

### Claude Code (coming soon)

```bash
# Copy hook config to your project
cp adapters/claude-code/hooks.json .claude/settings.local.json

# That's it — hooks fire automatically
```

## Configuration

All settings go in your plugin config or environment:

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

## Project Structure

```
openclaw-omega/
├── core/                    # Platform-agnostic memory logic
│   ├── omega-client.ts      # Python bridge (subprocess / UDS)
│   ├── classifier.ts        # Rule-based content type classification
│   ├── formatter.ts         # Memory formatting for injection
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
├── hooks/                   # Legacy hook entry points
├── lib/                     # Utilities (validation, sanitization, logging)
├── tests/                   # Unit + integration tests
├── omega-hooks-prd.md       # Full build specification
├── CLAUDE.md                # Project context for AI-assisted development
└── claude-progress.txt      # Build progress tracker
```

## How It Was Built

This entire plugin was built autonomously by Claude Code in a single session using:

- **[Ralph Wiggum](https://github.com/anthropics/claude-code-plugins)** — Autonomous loop plugin that kept Claude Code iterating through all build tasks without human intervention
- **[Effective Harnesses pattern](https://docs.anthropic.com/en/docs/claude-code)** — `claude-progress.txt` + git commits as breadcrumbs surviving context compaction
- **Custom subagents** — `reference-reader` (studied Supermemory/OMEGA source), `test-runner` (isolated test execution), `integration-tester` (OMEGA bridge verification)
- **[Context7 MCP](https://github.com/upstash/context7)** — Live library docs instead of hallucinated APIs

The build spec (`omega-hooks-prd.md`) was written collaboratively in a prior session, then fed to Claude Code with a single autonomous prompt. The full research and methodology is documented in `autonomous-build-research.md`.

## Roadmap

- [x] Core memory engine integration (OMEGA bridge)
- [x] Rule-based content classifier
- [x] Auto-recall hook (OpenClaw)
- [x] Auto-capture hook (OpenClaw)
- [x] Dual-save (extracted facts + raw chunks)
- [x] Explicit tools (search, store, forget, profile)
- [x] Fail-open error handling
- [ ] Claude Code adapter (PreToolUse/PostToolUse hooks)
- [ ] UDS socket bridge (Phase 2 — ~5ms vs ~200ms latency)
- [ ] MCP server mode (alternative to hooks)
- [ ] Profile aggregation improvements
- [ ] Multi-project memory isolation

## Credits

Built on the shoulders of:

- **[OMEGA](https://github.com/omega-memory/omega-memory)** (Apache-2.0) — Local-first memory engine with SQLite, ONNX embeddings, contradiction detection, time-decay, and graph relationships
- **[Supermemory](https://github.com/supermemoryai/openclaw-supermemory)** (MIT) — Pioneered the hook-based implicit capture/recall pattern for AI agents

## License

MIT
