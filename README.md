# agentic-recall

**Persistent, implicit memory for AI coding agents. No cloud. No manual notes. No tool calls. It just remembers.**

---

## Two Great Ideas, One Missing Piece

Two open-source projects each solved half the memory problem for AI agents — but neither could solve it alone.

**[Supermemory](https://github.com/supermemoryai/openclaw-supermemory)** nailed the UX. Memory should be *implicit* — captured and recalled through lifecycle hooks, not tools the agent decides to use. When memory is a tool, agents forget to use it. When memory is a hook, it just works. One problem: it requires a $20/month proprietary cloud API.

**[OMEGA](https://github.com/omega-memory/omega-memory)** nailed the engine. Local SQLite + ONNX embeddings, semantic search, contradiction detection, time-decay, typed memories, graph relationships. Everything runs on your machine. One problem: it's tool-based — the agent has to *choose* to call `remember()`.

**agentic-recall** = Supermemory's hooks + OMEGA's engine. Implicit memory with zero cloud dependency.

| Capability | Supermemory | OMEGA | **agentic-recall** |
|------------|------------|-------|--------------------|
| Implicit capture/recall | ✅ Hook-based | ❌ Tool-based | ✅ |
| Fully local / no cloud | ❌ $20/mo API | ✅ SQLite + ONNX | ✅ |
| Confidence light (🟢🟡🔴) | ❌ | ❌ | ✅ |
| Self-check with isolation | ❌ | ❌ | ✅ |
| Contradiction detection | ❌ | ✅ | ✅ |
| Time-decay with floor | ❌ | ✅ | ✅ |
| Typed memories | ❌ | ✅ | ✅ |
| Graph relationships | ❌ | ✅ | ✅ |
| Raw chunk fallback | ✅ | ❌ | ✅ |
| Open source engine | ❌ Proprietary | ✅ Apache-2.0 | ✅ |

Neither project needed to change. They just needed each other.

---

## How It Works

### Capture (after every agent response)

```
You: "Let's use PostgreSQL instead of MongoDB — we need ACID for payments."
Agent: "Good call. I'll update the schema..."

→ Hook fires automatically
→ Classified as: decision (confidence: 0.92)
→ Stored: "Chose PostgreSQL over MongoDB — need ACID for payments"
→ Raw conversation chunk also stored as fallback
```

### Recall (before every agent response)

```
You: "Set up the database connection for the orders service"

→ Hook fires, semantic search runs
→ Injected into agent context:

  === RELEVANT MEMORIES (auto-recalled) ===

  [decision | 2h ago | score: 0.87 | id: mem_a1b2c3]
  Chose PostgreSQL over MongoDB — need ACID for payments.
  Source: session abc123

  === END MEMORIES | 🟢 2 memories, 187ms ===
```

### Confidence Light (🟢🟡🔴)

A single color indicator on every turn — like a battery icon for memory health.

| Color | Meaning | User Action |
|-------|---------|-------------|
| 🟢 | Healthy — relevant results, good scores | Ignore — keep working |
| 🟡 | Degraded — low relevance, high skip rate, elevated latency | Investigate if persistent |
| 🔴 | Broken — OMEGA unreachable, repeated errors | Run `agentic-recall doctor` |

The light measures **quality**, not just health. A running system with irrelevant results shows 🟡.

### Self-Check Isolation

When the agent discusses its own memory ("why didn't you remember X?"), that conversation must NOT be captured. Three layers prevent self-pollution:

1. **Capture blacklist** — pattern matching skips meta-memory conversations
2. **Diagnostic mode** — explicit flag pauses all capture during debugging
3. **Content stripping** — removes indicators, attribution tags, and memory blocks before storage

---

## Platform Support

| Platform | Hook Mechanism | Status |
|----------|---------------|--------|
| **OpenClaw** | `before_agent_start` / `agent_end` lifecycle hooks | ✅ Built |
| **Claude Code** | `UserPromptSubmit` / `Stop` / `SessionStart` hooks | ✅ Built |

One codebase, two entry points. Adapters are thin (~50 lines each) — everything else is shared.

---

## CLI Tools

```bash
npx agentic-recall status       # health + confidence light
npx agentic-recall stats        # 7-day usage statistics
npx agentic-recall doctor       # 16-point health check
npx agentic-recall search       # semantic memory search
npx agentic-recall log -f       # live event log tail
npx agentic-recall browse       # paginated memory browser
npx agentic-recall export       # dump memories as JSON
npx agentic-recall prune        # remove low-value memories
npx agentic-recall light        # confidence light signal breakdown
```

---

## Installation

### Prerequisites

- Node.js 18+
- Python 3.11+
- OMEGA: `pip install omega-memory && omega setup`

### Claude Code

```bash
git clone https://github.com/somedumbguy/agentic-recall
cd agentic-recall
npm install && npm run build
npm run install:claude-code
```

Restart Claude Code. Memory works from the first turn.

### OpenClaw

```bash
git clone https://github.com/somedumbguy/agentic-recall
cd agentic-recall
npm install && npm run build
# Register as OpenClaw plugin
```

---

## Configuration

All options configurable via environment variables (Claude Code) or plugin config (OpenClaw):

| Option | Env Var | Default | Description |
|--------|---------|---------|-------------|
| `autoRecall` | `AGENTIC_RECALL_AUTO_RECALL` | `true` | Inject memories before each turn |
| `autoCapture` | `AGENTIC_RECALL_AUTO_CAPTURE` | `true` | Store conversation after each turn |
| `maxRecallResults` | `AGENTIC_RECALL_MAX_RESULTS` | `10` | Max memories per turn |
| `recallMinScore` | `AGENTIC_RECALL_MIN_SCORE` | `0.3` | Minimum similarity threshold |
| `captureMode` | `AGENTIC_RECALL_CAPTURE_MODE` | `"all"` | `"all"` or `"smart"` |
| `dualSave` | `AGENTIC_RECALL_DUAL_SAVE` | `true` | Store facts + raw chunks |
| `connectionMode` | `AGENTIC_RECALL_CONNECTION_MODE` | `"auto"` | `"auto"`, `"uds"`, `"cli"` |
| `verbose` | `AGENTIC_RECALL_VERBOSE` | `false` | Live stderr feed |

---

## Roadmap

- [x] Core memory engine integration (OMEGA bridge)
- [x] Rule-based content classifier (5 types)
- [x] OpenClaw adapter (auto-recall + auto-capture)
- [x] Claude Code adapter (UserPromptSubmit / Stop / SessionStart)
- [x] Explicit tools (search, store, forget, profile)
- [x] Fail-open error handling
- [ ] **Observability** — confidence light, event log, CLI tools, self-check, capture isolation ← current
- [ ] UDS socket bridge (~5ms vs ~200ms)
- [ ] MCP server mode
- [ ] Enhanced intelligence (contradiction detection on capture, multi-project isolation)

---

## Credits

- **[Supermemory](https://github.com/supermemoryai/openclaw-supermemory)** (MIT) — Hook-based implicit capture/recall pattern
- **[OMEGA](https://github.com/omega-memory/omega-memory)** (Apache-2.0) — Local memory engine with semantic search, decay, contradiction detection

## License

MIT
