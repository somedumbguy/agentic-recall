# Autonomous Build Research: Claude Code Best Practices

## Research Summary

Compiled from Anthropic's official docs, engineering blog, community experience, and plugin ecosystem analysis (Feb 2026). Purpose: maximize the chance that Claude Code autonomously builds the openclaw-omega plugin to completion.

---

## 1. KEY INSIGHT: Anthropic's Own "Effective Harnesses" Pattern

**Source:** [anthropic.com/engineering/effective-harnesses-for-long-running-agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

Anthropic found that without structure, even Opus 4.5 fails autonomous builds in two predictable ways:
1. **One-shotting** — tries to build everything at once, runs out of context mid-implementation, next session inherits broken half-implemented code
2. **Premature completion** — sees some work done, declares the job finished

**Their solution: Initializer + Coding Agent pattern**
- **Initializer** (first session): Creates `claude-progress.txt`, generates a feature list with 200+ checkboxes all marked "failing", makes initial git commit
- **Coding Agent** (every subsequent session): Reads git log + progress file, runs dev server + tests, picks ONE feature, implements, commits, updates progress file

**Key artifacts that survive context resets:**
- `claude-progress.txt` — what's done, what's in progress, what's next
- Git history — commit messages as structured breadcrumbs
- Feature list — all requirements with pass/fail status

### What this means for our build:
We should adopt this pattern. Our PRD checklist is the feature list. We need `claude-progress.txt` as a living artifact. Every completed task should be a git commit.

---

## 2. SUBAGENTS: Context Isolation for Free

**Source:** [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents), [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)

Subagents are the #1 tool for preserving context. Each runs in its own context window and returns only a summary. Key patterns:

**Built-in subagents Claude uses automatically:**
- **Explore** — Read-only codebase search (quick/medium/very-thorough)
- **Plan** — Research agent for planning mode
- **General-purpose** — Complex multi-step tasks with both read and write

**Custom subagents for our build:**
We should create 3 project-specific subagents in `.claude/agents/`:

1. **`reference-reader`** — Read-only agent that studies Supermemory/OMEGA reference code and returns a summary of the patterns to port. Keeps all those file reads out of main context.
2. **`test-runner`** — Runs tests, captures output, returns pass/fail summary. Prevents verbose test output from flooding context.
3. **`integration-tester`** — Runs the Python bridge integration tests against real OMEGA and returns results.

**Critical rule:** Subagents cannot spawn other subagents. Chain from main conversation only.

---

## 3. TASKS: Native DAG-Based Task Management

**Source:** [Claude Code v2.1.16+, Jan 2026](https://venturebeat.com/orchestration/claude-codes-tasks-update-lets-agents-work-longer-and-coordinate-across)

Tasks replaced Todos in v2.1.16. Key advantages:
- **Dependency graphs (DAGs)** — Task 3 can't start until Tasks 1 and 2 complete
- **Filesystem persistence** — Stored in `~/.claude/tasks/`, survives compaction
- **Cross-session sharing** — Set `CLAUDE_CODE_TASK_LIST_ID="openclaw-omega"` to share across sessions
- **Blocker enforcement** — Prevents "hallucinated completion" where Claude tries to test code it hasn't written

### Usage for our build:
```bash
export CLAUDE_CODE_TASK_LIST_ID="openclaw-omega"
```
Then in the prompt: "Create tasks with dependencies for each Phase 1 item (1.1–1.11). Mark each task blocked by its prerequisites."

This gives us native progress tracking that survives compaction AND sessions.

---

## 4. RALPH WIGGUM: Autonomous Loop with Verification

**Source:** [Official Anthropic plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)

The Ralph Wiggum plugin intercepts Claude's exit via a Stop hook and re-feeds the original prompt. Perfect for "work through this checklist until everything passes."

**How it works:**
1. You run: `/ralph-loop "Your task" --completion-promise "DONE" --max-iterations 30`
2. Claude works on the task
3. Claude tries to exit → Stop hook blocks it
4. Same prompt re-fed → Claude sees modified files and continues
5. Repeat until completion promise found or max iterations hit

**Critical for our build:**
- Set `--max-iterations 30` as safety net (prevent runaway API costs)
- Use `--completion-promise "ALL_PHASES_COMPLETE"` 
- Include verification criteria in the prompt: "Output `ALL_PHASES_COMPLETE` only when: all unit tests pass, integration tests pass, TypeScript compiles clean"

**Warning:** Always specify `--max-iterations`. Without it, Claude loops indefinitely.

---

## 5. CONTEXT7 MCP: Prevent API Hallucination

**Source:** [context7.com](https://context7.com/docs/clients/claude-code), [upstash/context7](https://github.com/upstash/context7)

Context7 fetches live library documentation instead of relying on training data. For our build, relevant because Claude may not know current OpenClaw plugin SDK APIs.

**Setup:**
```bash
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
```

Or with API key for higher rate limits:
```bash
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key YOUR_KEY
```

**Usage:** Just add "use context7" when asking about library APIs, or configure auto-trigger in CLAUDE.md.

**Caveat:** Free tier is 1,000 requests/month (reduced from 6,000 in Jan 2026). For a single build session this is fine.

---

## 6. CLAUDE.md OPTIMIZATION

**Source:** [code.claude.com/docs/en/how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)

### Compact Instructions section
Add a `## Compact Instructions` section to CLAUDE.md. This tells the compactor what to preserve:

```markdown
## Compact Instructions
When compacting this conversation, ALWAYS preserve:
1. The current task being worked on (from Phase 1 checklist)
2. The build order and dependency chain
3. All critical constraints (fail-open, 5-second timeout, dual-save, etc.)
4. The reference file mapping (which Supermemory file maps to which output file)
5. Any integration test results (especially failures)
Focus on: the implementation progress and next steps.
```

### What gets loaded automatically:
- CLAUDE.md — always loaded at session start
- MEMORY.md — first 200 lines loaded at session start  
- Skills — descriptions loaded, full content on-demand

### Context budget awareness:
- MCP servers consume context with tool definitions. Run `/mcp` to check costs.
- Use MCP Tool Search (enabled by default in recent versions) for lazy-loading tool definitions — reduces context by up to 95%.

---

## 7. `claude-progress.txt` PATTERN

Adopted from Anthropic's harness research. Create this file at project root and update after every completed task:

```
# claude-progress.txt — Updated by Claude during build

## COMPLETED
- [x] 1.1 Project scaffolding (commit: abc123)
- [x] 1.2 types/index.ts (commit: def456)

## IN PROGRESS  
- [ ] 1.3 config.ts — halfway done, config parsing works, validation TODO

## BLOCKED
(none)

## NEXT UP
- [ ] 1.4 lib/validate.ts
- [ ] 1.5 lib/classifier.ts

## DECISIONS MADE
- Using Jest over Vitest (matches Supermemory reference)
- execFile over spawn for subprocess (simpler error handling)

## ISSUES ENCOUNTERED
- OMEGA store() returns undefined on duplicate content — dedup before storing
```

This file is the single source of truth for cross-context-window handoff.

---

## 8. GIT COMMITS AS BREADCRUMBS

Every completed task = one git commit with a structured message:

```
feat(1.3): config.ts — config parsing with defaults and validation

- Reads from openclaw.plugin.json
- Validates all required fields
- Defaults: autoRecall=true, maxResults=5, captureMode=auto
- Test: tests/config.test.ts (5/5 passing)
```

This means if compaction fires or a new session starts, `git log --oneline` instantly shows progress.

---

## 9. PLUGIN STACK RECOMMENDATION

### Install these (Tier 1 — high impact, low context cost):

| Plugin | Purpose | Install |
|--------|---------|---------|
| **ralph-wiggum** | Autonomous loop with verification | `/plugin install ralph-wiggum` |
| **claude-mem** | Compaction survival | `/plugin marketplace add thedotmack/claude-mem` then `/plugin install claude-mem` |
| **Context7** | Live library docs | `claude mcp add context7 -- npx -y @upstash/context7-mcp@latest` |

### Consider but don't over-load (Tier 2):

| Plugin | Purpose | Trade-off |
|--------|---------|-----------|
| **tdd-guard** | Enforces test-first | Adds lag to Write/Edit ops; our PRD already mandates test-first |
| **LSP plugins** | Type checking | vtsls for TS, pyright for Python — useful but adds MCP context cost |

### Skip (Tier 3 — too much context overhead):

| Plugin | Why skip |
|--------|----------|
| **>3 MCP servers total** | Research shows accuracy degrades 49%→74% error rate with many MCPs |
| **Agent orchestration frameworks** | Overkill for 15-file build |
| **Browser plugins** | CLI/backend only project |

---

## 10. CUSTOM SUBAGENTS FOR THIS BUILD

Create these in `.claude/agents/` before the build starts:

### `reference-reader.md`
```markdown
---
name: reference-reader
description: Read-only agent that studies Supermemory and OMEGA reference code and returns pattern summaries. Use when building a new file to understand the reference implementation first.
tools: Read, Grep, Glob
model: sonnet
---
You are a code analysis specialist. When given a reference file to study, you:
1. Read the entire file
2. Identify the key patterns, interfaces, and design decisions
3. Return a concise summary (under 500 words) of:
   - What the file does
   - Key interfaces/types used
   - Design patterns to port
   - Gotchas or edge cases handled
Do NOT suggest implementations. Just describe what you see.
```

### `test-runner.md`
```markdown
---
name: test-runner
description: Runs test suites and returns pass/fail summary. Use after implementing a file to verify tests pass without flooding main context with verbose output.
tools: Read, Bash, Glob
model: sonnet
---
You are a test execution specialist. When asked to run tests:
1. Run the specified test command
2. Capture the output
3. Return ONLY: number of tests, pass count, fail count, and for any failures: the test name and error message (first 3 lines only)
Do NOT return full stack traces or passing test details.
```

### `integration-tester.md`
```markdown
---
name: integration-tester
description: Tests the Python OMEGA bridge with real store/query operations. Use after building omega-client.ts to verify it works against the real OMEGA engine.
tools: Read, Bash, Glob
model: sonnet
---
You are an integration test specialist. When asked to test the OMEGA bridge:
1. Run the integration test script
2. Verify: store returns success, query returns matching results, fail-open works with invalid Python path, timeout works within 5 seconds
3. Return pass/fail for each test case with brief error details for failures
```

---

## 11. RECOMMENDED AUTONOMOUS WORKFLOW

Combining all research, the optimal workflow is:

### Pre-flight (human does this):
```bash
mkdir -p ~/projects/openclaw-omega/.claude/agents
cd ~/projects/openclaw-omega

# Place these files:
# - CLAUDE.md (updated version with Compact Instructions)
# - omega-hooks-prd.md
# - .claude/agents/reference-reader.md
# - .claude/agents/test-runner.md
# - .claude/agents/integration-tester.md

# Set shared task list
export CLAUDE_CODE_TASK_LIST_ID="openclaw-omega"

# Launch with permissions and ralph-wiggum
claude --dangerously-skip-permissions
```

### Phase 0 (in Claude Code):
```
/plugin install ralph-wiggum
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```

Then install Context7:
```
!claude mcp add context7 -- npx -y @upstash/context7-mcp@latest
```

### Phase 1 (Ralph loop):
```
/ralph-loop "Read CLAUDE.md and omega-hooks-prd.md. Set up the environment (install deps, clone refs, scaffold project). Then work through Phase 1 tasks 1.1–1.11 in order. For each file: use the reference-reader subagent to study the corresponding reference code first, then implement, then use the test-runner subagent to verify. After each completed task: git commit with structured message, update claude-progress.txt. After all tasks complete, run Phase 2 verification (unit tests, integration tests, TypeScript compilation). Output <promise>ALL_PHASES_COMPLETE</promise> only when ALL unit tests pass, ALL integration tests pass, and TypeScript compiles with zero errors." --max-iterations 30 --completion-promise "ALL_PHASES_COMPLETE"
```

This is the entire build in one command. Ralph keeps it going until done.

---

## 12. FAILURE MODES TO WATCH FOR

| Failure | Mitigation |
|---------|-----------|
| Compaction loses build state | `claude-progress.txt` + git commits + CLAUDE.md Compact Instructions |
| Claude declares "done" prematurely | Ralph Wiggum's completion promise requires ALL tests passing |
| OMEGA Python subprocess fails | Fail-open constraint in CLAUDE.md; integration-tester subagent verifies |
| API hallucination (wrong OpenClaw SDK) | Context7 MCP fetches live docs |
| Context fills with test output | test-runner subagent isolates verbose output |
| Context fills with reference code reading | reference-reader subagent isolates codebase exploration |
| Claude tries to do too many things at once | Tasks with dependency DAG enforce sequential execution |
| Type errors accumulate | Run `npx tsc --noEmit` after each file (in test-runner subagent) |
| Max iterations hit without completion | 30 should be enough for 15 files; increase if needed |

---

## Sources

1. Anthropic, "Effective harnesses for long-running agents" (Nov 2025)
2. Anthropic, "Best Practices for Claude Code" (code.claude.com)
3. Anthropic, "How Claude Code works" (code.claude.com)
4. Anthropic, ralph-wiggum plugin (official GitHub)
5. Upstash, Context7 MCP (github.com/upstash/context7)
6. thedotmack, claude-mem plugin
7. nizos, tdd-guard plugin
8. VentureBeat, "Claude Code's Tasks update" (Jan 2026)
9. ClaudeFast, "Ralph Wiggum Autonomous Loops" (Feb 2026)
10. PubNub, "Best practices for Claude Code subagents" (Aug 2025)
