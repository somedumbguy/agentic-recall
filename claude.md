# CLAUDE.md — Project Context for agentic-recall

## What is this project?

`agentic-recall` is a platform-agnostic memory system for AI coding agents. It provides automatic memory capture and recall backed by OMEGA's local-first engine.

It merges:
- **Supermemory's hook pattern** (implicit capture/recall via lifecycle events — no agent decisions needed)
- **OMEGA's intelligence** (local SQLite + ONNX embeddings, contradiction detection, time-decay, typed memories, graph relationships)

Works on both **OpenClaw** and **Claude Code**.

## Current Phase: 1.5 — Observability

**Read `PHASE1.5-OBSERVABILITY-SPEC.md` for the full spec.** This is the active build target.

What's being built:
- **Confidence light** (🟢🟡🔴) — per-turn quality indicator injected in memory block footer
- **Event log** — structured JSONL with rotation (`~/.agentic-recall/events.jsonl`)
- **CLI tools** — status, stats, doctor, search, log, browse, export, prune, light
- **Self-check** — periodic background health evaluation (every 25 turns / 5min)
- **Capture isolation** — 3 layers preventing meta-memory pollution (blacklist + diagnostic mode + stripping)
- **Attribution tags** — memory IDs and source in injected context

## Key files

- `PHASE1.5-OBSERVABILITY-SPEC.md` — **ACTIVE BUILD SPEC. Read this for current work.**
- `omega-hooks-prd.md` — Original Phase 1 build spec (architecture reference)
- `claude-code-adapter-spec.md` — Claude Code adapter spec (Phase 1a, already built)
- `claude-progress.txt` — **LIVING PROGRESS LOG. Read after compaction or restart.**

## Architecture in 30 seconds

```
Agent Runtime (OpenClaw or Claude Code)
  ├─ UserPromptSubmit / before_agent_start
  │   → adapters/*/recall.ts
  │   → core/omega-client.ts → OMEGA query()
  │   → core/formatter.ts → format + attribution tags
  │   → core/confidence-light.ts → compute 🟢🟡🔴
  │   → inject memories + light into context
  │
  └─ Stop / agent_end
      → core/isolation.ts → check meta-patterns, diagnostic mode
      → core/sanitize.ts → strip memory blocks, indicators
      → core/classifier.ts → classify content type
      → core/omega-client.ts → OMEGA store()
      → core/event-log.ts → log event

OMEGA Python Engine (subprocess, Phase 2: UDS socket)
  └─ from omega import store, query
  └─ omega.db (SQLite + bge-small-en-v1.5 ONNX)
```

## Critical constraints

1. **All OMEGA calls are fail-open** — if Python subprocess fails, return empty and continue. NEVER block the agent.
2. **5-second timeout** on all subprocess calls.
3. **Confidence light on every recall** — 🟢🟡🔴 in the `=== END MEMORIES ===` footer.
4. **Three-layer capture isolation:**
   - Layer 1: Meta-memory pattern blacklist (skip capture for diagnostic conversations)
   - Layer 2: Diagnostic mode flag (pauses all capture)
   - Layer 3: Content stripping (removes indicators, attribution, memory blocks before storage)
5. **Event log is non-blocking** — async writes, buffered, rotated. Never adds latency.
6. **Confidence state is in-memory only** — ring buffer, ~5KB, resets each session. No persistence.
7. **Self-check never injects when green** — only adds advisory line when degraded (🟡/🔴).
8. **Dual-save on capture** — store both extracted facts AND raw conversation chunks.
9. **Rule-based classifier** — no LLM calls. Pattern matching only. <1ms.

## File structure

```
core/                          # Platform-agnostic (shared by both adapters)
  omega-client.ts              # Python bridge (subprocess / UDS)
  classifier.ts                # Rule-based content classification
  formatter.ts                 # Memory formatting + attribution tags
  confidence-light.ts          # 🟢🟡🔴 scoring algorithm
  confidence-state.ts          # In-memory rolling window (ring buffer)
  self-check.ts                # Periodic health evaluation
  event-log.ts                 # Structured JSONL logger with rotation
  isolation.ts                 # Capture blacklist + diagnostic mode + stripping
  sanitize.ts                  # Content sanitization
  config.ts                    # Config with env var support
  types.ts                     # Shared types

adapters/
  openclaw/recall.ts           # before_agent_start → core recall
  openclaw/capture.ts          # agent_end → core capture
  claude-code/recall.ts        # UserPromptSubmit → core recall
  claude-code/capture.ts       # Stop → core capture
  claude-code/init.ts          # SessionStart → health check

cli/                           # CLI tools (status, stats, doctor, search, etc.)
```

## Workflow rules

1. **One task at a time.** Complete and commit before starting the next.
2. **Test immediately.** Run tests after each file.
3. **Commit after each task.** Message: `feat(phase1.5): filename — description`
4. **Update progress.** After every commit, update `claude-progress.txt`.
5. **Core modules first, adapters second.** Build confidence-light.ts → confidence-state.ts → self-check.ts → event-log.ts → isolation.ts, THEN wire into both adapters.

## How to test

```bash
# OMEGA is installed. Test bridge:
python3 -c "from omega import store; store('test memory', 'general'); print('stored')"
python3 -c "from omega import query; print(query('test'))"

# Run all tests:
npm test

# Build:
npm run build
```

## Compact Instructions

When compacting, ALWAYS preserve:
1. Current Phase 1.5 task being worked on
2. Which core modules are done vs remaining
3. Which adapters have been wired with observability
4. All critical constraints (fail-open, isolation layers, non-blocking log, in-memory state)
5. Test results and any failures
6. Location of `claude-progress.txt` for state recovery
