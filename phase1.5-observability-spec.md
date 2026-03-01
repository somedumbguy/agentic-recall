# Phase 1.5 Spec: Observability for agentic-recall

## Autonomous Build Spec — Zero Questions, Zero Ambiguity

**Version:** 2.0
**Prerequisite:** Phase 1 (core plugin) and Claude Code adapter must be built.
**Priority:** BEFORE Phase 2 (UDS bridge). You need to see what's happening before optimizing it.
**Estimated effort:** 30 iterations (Ralph Wiggum at --max-iterations 30)
**Completion promise:** `OBSERVABILITY_COMPLETE`

---

## 1. Design Philosophy

agentic-recall is invisible by design. That invisibility creates a trust problem. Users need to know:

1. **Is it working?** → Confidence light (🟢🟡🔴)
2. **What's happening?** → Event log + live feed
3. **What does it know?** → CLI tools (search, browse, export)
4. **Why did it know that?** → Attribution tags
5. **Is it healthy?** → Doctor + self-check

Three constraints govern all observability:

- **No self-pollution:** Diagnostic activity must NEVER be captured as memories. The memory system must not remember its own health checks.
- **Platform-agnostic core:** The confidence light, event log, and self-check logic live in `core/`. Adapters only handle how to surface the indicator in their platform's UI.
- **Zero overhead on happy path:** When everything is green, observability adds <1ms and 0 context tokens beyond the indicator itself.

---

## 2. The Confidence Light

### Concept

A single color indicator injected into every recall response. Like a battery icon — you ignore it until it changes.

| Color | Meaning | User Action |
|-------|---------|-------------|
| 🟢 | Memory system healthy, relevant memories found, good confidence | None — keep working |
| 🟡 | Degraded — low relevance scores, high skip rate, elevated latency, or no memories found for a prompt that probably should have some | Investigate if pattern continues |
| 🔴 | Broken — OMEGA unreachable, repeated errors, capture/recall failing | Act now |

### Scoring Algorithm (`core/confidence-light.ts`)

The light is NOT a simple health check. It reflects **memory quality** — a system can be technically healthy but operationally useless.

```typescript
interface ConfidenceSignals {
  // Recall signals (from current turn)
  recallSuccess: boolean;          // did the OMEGA query succeed?
  memoriesFound: number;           // total results before filtering
  memoriesInjected: number;        // results after dedup + score filter
  topScore: number;                // highest similarity score (0-1)
  avgScore: number;                // average score of injected memories
  recallLatency: number;           // ms

  // Recent history signals (from event log, rolling window)
  recentErrorCount: number;        // OMEGA errors in last 30 minutes
  recentSkipRate: number;          // capture_skipped / total captures, last 50 turns
  recentRecallMissRate: number;    // recall_miss / total recalls, last 50 turns
  consecutiveMisses: number;       // recalls in a row with 0 results
  avgRecentLatency: number;        // average OMEGA call latency, last 50 calls

  // System signals
  omegaReachable: boolean;         // can we talk to OMEGA at all?
  lastCaptureAge: number;          // seconds since last successful capture
  lastSuccessfulRecall: number;    // seconds since last recall_hit
}

type LightColor = 'green' | 'yellow' | 'red';

function computeLight(signals: ConfidenceSignals): { color: LightColor; reason: string } {
  // RED conditions — system is broken
  if (!signals.omegaReachable) 
    return { color: 'red', reason: 'OMEGA unreachable' };
  if (signals.recentErrorCount > 10) 
    return { color: 'red', reason: `${signals.recentErrorCount} errors in 30min` };
  if (!signals.recallSuccess) 
    return { color: 'red', reason: 'recall query failed' };
  if (signals.lastCaptureAge > 3600 && signals.lastSuccessfulRecall > 3600) 
    return { color: 'red', reason: 'no activity in 1+ hour' };

  // YELLOW conditions — degraded quality
  if (signals.topScore < 0.3 && signals.memoriesFound > 0) 
    return { color: 'yellow', reason: `low relevance (top: ${signals.topScore.toFixed(2)})` };
  if (signals.memoriesInjected === 0 && signals.consecutiveMisses >= 3) 
    return { color: 'yellow', reason: `${signals.consecutiveMisses} consecutive misses` };
  if (signals.recentSkipRate > 0.4) 
    return { color: 'yellow', reason: `high skip rate (${(signals.recentSkipRate * 100).toFixed(0)}%)` };
  if (signals.recentRecallMissRate > 0.6) 
    return { color: 'yellow', reason: `low hit rate (${((1 - signals.recentRecallMissRate) * 100).toFixed(0)}%)` };
  if (signals.recallLatency > 1000) 
    return { color: 'yellow', reason: `slow recall (${signals.recallLatency}ms)` };
  if (signals.avgRecentLatency > 500) 
    return { color: 'yellow', reason: `avg latency elevated (${signals.avgRecentLatency.toFixed(0)}ms)` };
  if (signals.recentErrorCount > 3) 
    return { color: 'yellow', reason: `${signals.recentErrorCount} recent errors` };

  // GREEN — everything healthy
  return { color: 'green', reason: '' };
}
```

**Key design: the light evaluates QUALITY, not just HEALTH.**

- A green system with 0 relevant memories still shows 🟢 if it's a genuinely new topic (no memories should exist)
- But 3+ consecutive misses on related prompts shows 🟡 because memories *should* be accumulating
- High latency shows 🟡 even if results are good — this establishes the baseline for Phase 2

### Rolling Window State (`core/confidence-state.ts`)

The confidence light needs recent history. We keep a lightweight in-memory ring buffer — NOT persisted to disk, NOT stored in OMEGA, NO risk of self-pollution:

```typescript
class ConfidenceState {
  private recallEvents: RingBuffer<RecallEvent>;   // last 50 recalls
  private captureEvents: RingBuffer<CaptureEvent>; // last 50 captures
  private omegaCalls: RingBuffer<OmegaCallEvent>;  // last 50 OMEGA calls
  private errorCount: number = 0;
  private errorWindowStart: number = Date.now();
  private consecutiveMisses: number = 0;
  private lastCaptureTime: number = 0;
  private lastRecallHitTime: number = 0;

  constructor(windowSize: number = 50) {
    this.recallEvents = new RingBuffer(windowSize);
    this.captureEvents = new RingBuffer(windowSize);
    this.omegaCalls = new RingBuffer(windowSize);
  }

  recordRecall(hit: boolean, score: number, count: number, latency: number): void { ... }
  recordCapture(stored: boolean, skipped: boolean, type: string): void { ... }
  recordOmegaCall(method: string, latency: number, success: boolean): void { ... }
  recordError(): void { ... }

  getSignals(): ConfidenceSignals { ... }

  // Reset error window every 30 minutes
  private pruneErrorWindow(): void {
    if (Date.now() - this.errorWindowStart > 30 * 60 * 1000) {
      this.errorCount = 0;
      this.errorWindowStart = Date.now();
    }
  }
}
```

**Ring buffer:** Fixed-size circular array. When full, oldest entry is overwritten. Memory usage is constant: 50 entries × ~100 bytes = ~5KB. Negligible.

**CRITICAL: This state is in-memory only.** It does NOT survive session restarts. This is intentional — each session starts with a fresh green light. The event log on disk provides cross-session historical data for the CLI tools, but the light itself is session-scoped.

### Platform Rendering

The confidence light appears differently on each platform, but the scoring logic is identical (shared `core/confidence-light.ts`).

#### Claude Code

Injected in the memory block footer:

**Green (memories found):**
```
=== RELEVANT MEMORIES (auto-recalled) ===

[decision | 2h ago | score: 0.91 | id: mem_a1b2c3]
Chose PostgreSQL over MongoDB — need ACID for payments.
Source: session abc123

=== END MEMORIES | 🟢 4 memories, 187ms ===
```

**Green (no memories, but that's expected):**
```
=== END MEMORIES | 🟢 0 memories, 43ms ===
```

**Yellow:**
```
=== END MEMORIES | 🟡 low relevance (top: 0.34), 312ms ===
```

**Red:**
```
=== RECALL SKIPPED | 🔴 OMEGA unreachable ===
```

**Where it appears:** In the `additionalContext` field of the `UserPromptSubmit` hook output. The agent sees it. The user sees it if they expand the context. The capture hook strips it (along with the rest of the memory block) so it never becomes a memory.

**Also in stderr** (visible in Ctrl+O verbose mode):
```
[agentic-recall] 🟢 4 memories injected (187ms, top: 0.91)
[agentic-recall] 🟡 0 memories, 3 consecutive misses (43ms)
[agentic-recall] 🔴 OMEGA unreachable — recall skipped
```

#### OpenClaw

Injected via `api.prependContext()` — same format as Claude Code:

```
=== END MEMORIES | 🟢 4 memories, 187ms ===
```

Also available via the plugin's status API (if OpenClaw exposes one) and logged to event log.

#### Both Platforms — Capture Side

After capture, a one-line stderr indicator:
```
[agentic-recall] captured: decision (0.92) 🟢 203ms
[agentic-recall] skipped: too_short 🟢
[agentic-recall] capture failed: OMEGA error 🟡
```

The capture indicator doesn't inject into context (nothing to inject — capture runs after the agent responds). It only appears in stderr and the event log.

---

## 3. Self-Check Isolation

### The Problem

When the agent diagnoses its own memory system, that diagnostic conversation gets captured as a memory. Now you have memories about memory health, classifier accuracy, and error counts — polluting real results forever.

### The Solution: Three-Layer Isolation

**Layer 1: Capture Blacklist Patterns**

The capture hook recognizes meta-memory conversations and skips them:

```typescript
// In capture hook, before classification
const META_PATTERNS = [
  /memory.*(status|health|check|diagnos)/i,
  /agentic.recall.*(stats|doctor|error|broken)/i,
  /why.*(didn't|didn't|not).*(remember|recall|know)/i,
  /what.*(do you|does it).*(remember|know about)/i,
  /how.*(many|much).*(memor|stored|captured)/i,
  /memory.*(system|engine|database|log)/i,
  /\/(memory-check|recall-status|memory-debug)/,  // slash commands
  /confidence.*light|🟢|🟡|🔴/,                    // light itself
  /OMEGA.*(error|unreachable|status|version)/i,
];

function isMetaMemoryConversation(userMessage: string, assistantMessage: string): boolean {
  const combined = userMessage + ' ' + assistantMessage;
  return META_PATTERNS.some(pattern => pattern.test(combined));
}

// In capture flow:
if (isMetaMemoryConversation(lastTurn.user, lastTurn.assistant)) {
  await eventLog.log({ event: 'capture_skipped', details: { reason: 'meta_memory_conversation' } });
  process.exit(0); // or return, depending on adapter
}
```

**Layer 2: Diagnostic Mode Flag**

For extended debugging sessions, a session-level flag pauses ALL capture:

```typescript
// Activated by:
// - Slash command: /memory-debug (sets flag)
// - Environment variable: AGENTIC_RECALL_DIAGNOSTIC=true
// - Tool call: memory_diagnostic tool (sets flag for duration of tool execution)

// In capture hook:
if (diagnosticMode.isActive()) {
  await eventLog.log({ event: 'capture_skipped', details: { reason: 'diagnostic_mode' } });
  return; // skip capture entirely
}
```

**How diagnostic mode works across platforms:**

Claude Code:
- Set via environment variable: `AGENTIC_RECALL_DIAGNOSTIC=true` in the session
- Or via a file flag: touch `~/.agentic-recall/.diagnostic-mode`
- Capture hook checks for both
- Auto-clears when file is older than 1 hour (prevents forgotten flags)

OpenClaw:
- Set via slash command: `/memory-debug on` / `/memory-debug off`
- Stored in plugin state (in-memory, session-scoped)
- Auto-clears on session end

**Layer 3: Context Stripping (Already Exists)**

The capture hook already strips `=== RELEVANT MEMORIES ===` blocks before storing. Extend this to also strip:
- Confidence light indicators (🟢🟡🔴)
- Memory system status lines
- Attribution source lines
- Any `[agentic-recall]` prefixed content

```typescript
function stripMemorySystemContent(text: string): string {
  let cleaned = text;
  // Strip memory injection blocks
  cleaned = cleaned.replace(/===\s*RELEVANT MEMORIES.*?===\s*END MEMORIES.*?===/gs, '');
  cleaned = cleaned.replace(/===\s*RECALL SKIPPED.*?===/g, '');
  // Strip confidence indicators
  cleaned = cleaned.replace(/[🟢🟡🔴]\s*[\d]+ memories.*$/gm, '');
  // Strip attribution lines
  cleaned = cleaned.replace(/^Source:.*$/gm, '');
  // Strip system status lines
  cleaned = cleaned.replace(/\[agentic-recall\].*$/gm, '');
  // Strip memory IDs
  cleaned = cleaned.replace(/\| id: mem_\w+/g, '');
  return cleaned.trim();
}
```

**All three layers work together:**
1. Pattern matching catches most meta-memory conversations (Layer 1)
2. Explicit diagnostic mode catches extended debugging sessions (Layer 2)  
3. Content stripping catches any system metadata that leaks through (Layer 3)

Belt, suspenders, and a safety net.

---

## 4. Silent Self-Check System

### Concept

On every recall, the confidence light silently evaluates system health. But we also need periodic deeper checks that:
- Don't fire on every turn (expensive)
- Don't inject into context (noisy)
- Don't get captured (self-pollution)
- DO surface problems when they matter

### Implementation: Periodic Background Check (`core/self-check.ts`)

```typescript
interface SelfCheckResult {
  overall: LightColor;
  checks: CheckResult[];
  recommendations: string[];
}

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

class SelfChecker {
  private lastCheckTime: number = 0;
  private lastResult: SelfCheckResult | null = null;
  private checkInterval: number;  // default: 300000 (5 minutes)
  private turnsSinceCheck: number = 0;
  private turnsPerCheck: number;   // default: 25 turns

  constructor(config: ObservabilityConfig) {
    this.checkInterval = config.selfCheckInterval || 300000;
    this.turnsPerCheck = config.selfCheckEveryNTurns || 25;
  }

  // Called on every recall. Returns null if no check needed.
  // Returns result if check was due.
  async checkIfDue(): Promise<SelfCheckResult | null> {
    this.turnsSinceCheck++;
    
    const timeSinceCheck = Date.now() - this.lastCheckTime;
    const turnsDue = this.turnsSinceCheck >= this.turnsPerCheck;
    const timeDue = timeSinceCheck >= this.checkInterval;
    
    if (!turnsDue && !timeDue) return null;
    
    this.turnsSinceCheck = 0;
    this.lastCheckTime = Date.now();
    this.lastResult = await this.runChecks();
    return this.lastResult;
  }

  private async runChecks(): Promise<SelfCheckResult> {
    const checks: CheckResult[] = [];
    const recommendations: string[] = [];

    // 1. OMEGA reachability
    try {
      const healthy = await omegaHealth();
      checks.push({ name: 'omega_reachable', status: healthy ? 'pass' : 'fail', message: healthy ? 'OMEGA responding' : 'OMEGA unreachable' });
      if (!healthy) recommendations.push('Check OMEGA installation: omega doctor');
    } catch {
      checks.push({ name: 'omega_reachable', status: 'fail', message: 'Health check threw error' });
      recommendations.push('OMEGA may need reinstalling: pip install omega-memory');
    }

    // 2. Capture health (from confidence state)
    const signals = confidenceState.getSignals();
    if (signals.recentSkipRate > 0.4) {
      checks.push({ name: 'capture_quality', status: 'warn', message: `${(signals.recentSkipRate * 100).toFixed(0)}% of turns skipped` });
      recommendations.push('High skip rate — conversations may be too short or trivial for capture');
    } else {
      checks.push({ name: 'capture_quality', status: 'pass', message: 'Capture rate healthy' });
    }

    // 3. Recall relevance
    if (signals.recentRecallMissRate > 0.6) {
      checks.push({ name: 'recall_relevance', status: 'warn', message: `${((1 - signals.recentRecallMissRate) * 100).toFixed(0)}% hit rate` });
      recommendations.push('Low recall hit rate — memories may not match current work context');
    } else {
      checks.push({ name: 'recall_relevance', status: 'pass', message: 'Recall relevance healthy' });
    }

    // 4. Latency
    if (signals.avgRecentLatency > 500) {
      checks.push({ name: 'latency', status: 'warn', message: `${signals.avgRecentLatency.toFixed(0)}ms average` });
      recommendations.push('Elevated latency — consider UDS socket bridge (Phase 2)');
    } else {
      checks.push({ name: 'latency', status: 'pass', message: `${signals.avgRecentLatency.toFixed(0)}ms average` });
    }

    // 5. Error rate
    if (signals.recentErrorCount > 5) {
      checks.push({ name: 'error_rate', status: 'fail', message: `${signals.recentErrorCount} errors in 30min` });
      recommendations.push('Multiple OMEGA errors — check omega doctor and event log');
    } else if (signals.recentErrorCount > 0) {
      checks.push({ name: 'error_rate', status: 'warn', message: `${signals.recentErrorCount} errors in 30min` });
    } else {
      checks.push({ name: 'error_rate', status: 'pass', message: 'No recent errors' });
    }

    // Determine overall color
    const hasFail = checks.some(c => c.status === 'fail');
    const hasWarn = checks.some(c => c.status === 'warn');
    const overall: LightColor = hasFail ? 'red' : hasWarn ? 'yellow' : 'green';

    return { overall, checks, recommendations };
  }

  getLastResult(): SelfCheckResult | null {
    return this.lastResult;
  }
}
```

### How Self-Check Surfaces Problems

**When everything is green:** Nothing extra happens. The per-turn confidence light is enough.

**When self-check finds yellow/red:** It injects a ONE-LINE advisory into the next recall's context block:

```
=== END MEMORIES | 🟡 elevated latency (avg 430ms) — run `agentic-recall doctor` for details ===
```

or:

```
=== END MEMORIES | 🔴 OMEGA errors detected — run `agentic-recall doctor` ===
```

This is:
- One line (minimal context cost)
- Actionable (tells user what to do)
- Stripped by capture hook (never becomes a memory)
- Only injected when self-check detects degradation (not every turn)

**When the agent explicitly asks about memory health** (via tool or slash command):
- Diagnostic mode auto-activates (Layer 2 isolation)
- Full self-check runs immediately (not waiting for interval)
- Detailed results returned to agent
- Capture paused for the exchange

---

## 5. Event Log System

### Task 1: Structured Event Logger (`core/event-log.ts`)

Every recall, capture, classification, and error produces a structured log entry written to a JSON Lines file.

**Log location:**
- Default: `~/.agentic-recall/events.jsonl`
- Override: `AGENTIC_RECALL_LOG_PATH` env var
- Max file size: 10MB, then rotate to `events.jsonl.1` (keep 2 rotations = 30MB max)

**Event schema:**

```typescript
interface LogEvent {
  timestamp: string;          // ISO 8601
  event: EventType;
  session_id: string;
  platform: 'openclaw' | 'claude-code';
  duration_ms: number;
  light: LightColor;          // confidence light at time of event
  details: Record<string, any>;
}

type EventType =
  | 'recall_start'
  | 'recall_hit'
  | 'recall_miss'
  | 'recall_error'
  | 'capture_start'
  | 'capture_stored'
  | 'capture_skipped'
  | 'capture_classified'
  | 'capture_error'
  | 'self_check'             // periodic self-check result
  | 'diagnostic_mode'        // diagnostic mode toggled
  | 'connection_mode'
  | 'health_check'
  | 'config_loaded'
  | 'omega_call'
  | 'omega_error';
```

**New event detail payloads (additions to original spec):**

```typescript
// self_check
{
  overall: LightColor,
  checks: CheckResult[],
  recommendations: string[],
  triggered_by: 'interval' | 'turns' | 'explicit'
}

// diagnostic_mode
{
  active: boolean,
  triggered_by: 'slash_command' | 'env_var' | 'file_flag' | 'tool_call' | 'auto_clear'
}

// capture_skipped (new reasons)
{
  reason: 'too_short' | 'too_long' | 'empty' | 'low_confidence' 
        | 'auto_capture_disabled' | 'meta_memory_conversation' | 'diagnostic_mode'
}

// recall_hit / recall_miss (add light)
{
  // ... existing fields ...
  light: LightColor,
  light_reason: string
}
```

**All event payloads from the original spec remain.** The `light` field is added to the base `LogEvent` so every event carries the current confidence state.

**Implementation requirements (same as original):**
1. Non-blocking writes (async `fs.appendFile` or write stream)
2. Rotation at max size
3. Buffered writes (flush every 500ms or 10 entries)
4. Graceful degradation (if unwritable, warn once, disable)
5. Privacy-safe previews (100 char truncation)

### Task 2: Wire Logger Into All Operations

Same as original spec — instrument every recall, capture, OMEGA call, init, and error. Additionally:

- Every `recall_hit` and `recall_miss` event now includes `light` and `light_reason`
- Every `self_check` event logs the full check result
- `diagnostic_mode` events log when isolation is activated/deactivated
- `capture_skipped` events log the specific isolation layer that triggered the skip

---

## 6. CLI Commands

### Task 3: CLI Entry Point (`cli/index.ts`)

```bash
npx agentic-recall status       # quick health + confidence light
npx agentic-recall stats        # usage statistics
npx agentic-recall doctor       # comprehensive health check
npx agentic-recall search       # search memories
npx agentic-recall log          # tail the event log
npx agentic-recall browse       # paginated memory browser
npx agentic-recall export       # export all memories as JSON
npx agentic-recall prune        # remove low-value memories
npx agentic-recall light        # show current confidence light + reasoning
```

### Task 4: `status` Command

```
$ npx agentic-recall status

agentic-recall v1.0.0  🟢
  OMEGA:        ✅ v0.9.2
  Memories:     847 (142 decisions, 89 lessons, 203 preferences, 58 errors, 355 general)
  Last capture: 3m ago — decision: "Use Redis for session caching"
  Last recall:  1m ago — 4 memories injected (top: 0.91, 187ms)
  Transport:    CLI (avg 195ms)
  Session:      2h 14m active
```

### Task 5: `stats` Command

```
$ npx agentic-recall stats

=== agentic-recall Statistics (last 7 days) ===

CONFIDENCE LIGHT
  🟢 Green:     87% of turns
  🟡 Yellow:    11% of turns (mostly low relevance)
  🔴 Red:       2% of turns (OMEGA timeout, 1 incident)

CAPTURE
  Total:        342 stored, 89 skipped
  By type:      decision: 67  lesson: 45  preference: 28  error: 19  general: 183
  Skip reasons: too_short: 52  low_confidence: 31  meta_memory: 4  too_long: 2
  Avg confidence: 0.74

RECALL
  Total:        412 (287 hits, 125 misses — 70% hit rate)
  Avg injected: 3.4 memories/turn
  Avg top score: 0.82
  Avg latency:  187ms

SELF-CHECKS
  Ran: 14 checks
  Results: 🟢 11  🟡 2  🔴 1
  Common warnings: elevated latency (2x), low hit rate (1x)
```

### Task 6: `doctor` Command

Same 16 checks as original spec, plus:

```
[✅] Self-check system            running (every 25 turns / 5min)
[✅] Capture isolation             3 layers active (patterns + flag + stripping)
[✅] No meta-memory pollution      0 diagnostic memories found in DB
[✅] Confidence light              🟢 (last 50 turns: 🟢 47, 🟡 3, 🔴 0)
```

**New check: meta-memory pollution detection**
Query OMEGA for memories matching meta-patterns. If any are found, flag as warning and offer to delete them:
```
[⚠️] Meta-memory pollution         3 diagnostic memories found
     Run `agentic-recall prune --meta` to remove them.
```

### Task 7: `light` Command (NEW)

Dedicated command to inspect the confidence light:

```
$ npx agentic-recall light

Current: 🟢 (healthy)

Signal breakdown:
  OMEGA reachable:      ✅
  Last recall:          hit (score: 0.91, 187ms) 
  Consecutive misses:   0
  Skip rate:            18% (threshold: 40%)
  Hit rate:             70% (threshold: 40%)
  Avg latency:          195ms (threshold: 500ms)
  Recent errors:        0 (threshold: 5)
  Last capture:         3 minutes ago

History (last 20 turns):
  🟢🟢🟢🟢🟡🟢🟢🟢🟢🟢🟢🟢🟡🟢🟢🟢🟢🟢🟢🟢

Thresholds:
  🟢 → 🟡:  top_score < 0.3, skip_rate > 40%, hit_rate < 40%, latency > 500ms, errors > 3
  🟡 → 🔴:  OMEGA unreachable, errors > 10, recall query failed
```

### Tasks 8-12: Other CLI Commands

Same as original spec: `search`, `log`, `browse`, `export`, `prune`.

**Addition to `prune`:** New `--meta` flag that specifically removes diagnostic/meta-memory pollution:
```bash
$ npx agentic-recall prune --meta --dry-run

Would remove 3 meta-memory entries:
  - "OMEGA has 847 memories, 8 errors in last hour" (general, 2d ago)
  - "Memory system status check passed" (general, 3d ago)  
  - "Confidence light showing yellow due to latency" (general, 5d ago)

$ npx agentic-recall prune --meta
Removed 3 meta-memory entries.
```

---

## 7. Attribution Tags

### Task 13: Memory Source Attribution

Same as original spec. Every injected memory gets:
- `id:` field for reference
- `Source:` line for provenance
- Footer with count, latency, and confidence light

### Task 14: Attribution Tool

Same as original spec. Register `memory_attribution` tool for "why did you know that?" queries. When this tool is invoked, diagnostic mode auto-activates for the duration of the tool call (Layer 2 isolation).

---

## 8. Platform-Specific Adapter Updates

### Task 15: Claude Code Adapter

**`adapters/claude-code/recall.ts` changes:**
1. Import and instantiate `ConfidenceState` and `SelfChecker` (as module-level singletons)
2. After OMEGA query, record in confidence state
3. Compute confidence light
4. Include light in `additionalContext` footer
5. Run self-check if due; if degraded, add advisory line
6. Output to stderr: `[agentic-recall] 🟢 4 memories (187ms)`
7. Log event with light color

**`adapters/claude-code/capture.ts` changes:**
1. Check diagnostic mode flag before processing
2. Run meta-memory pattern check on extracted turn
3. If either triggers, skip capture and log reason
4. If capture proceeds, record in confidence state
5. Output to stderr: `[agentic-recall] captured: decision (0.92) 🟢`
6. Strip all memory system content from turn before storing

**`adapters/claude-code/init.ts` changes:**
1. Initialize confidence state (fresh green)
2. Run initial health check
3. Log `config_loaded` and `health_check` events
4. Output to stderr: `[agentic-recall] initialized 🟢 (OMEGA v0.9.2, 847 memories)`

### Task 16: OpenClaw Adapter

**`adapters/openclaw/recall.ts` changes:**
Same logic as Claude Code adapter. The confidence light is computed identically. The difference is how it's surfaced:
- Injected via `api.prependContext()` (same format as Claude Code's `additionalContext`)
- No stderr (OpenClaw doesn't surface stderr to users)
- Event log is identical

**`adapters/openclaw/capture.ts` changes:**
Same isolation logic. The diagnostic mode is stored in plugin state (via `api.setState()` if available, or in-memory singleton).

**`adapters/openclaw/index.ts` changes:**
- Register `/memory-debug` slash command to toggle diagnostic mode
- Register `memory_attribution` tool
- Register `memory_light` tool (returns current confidence light + reasoning)
- On service startup: initialize confidence state, run health check

---

## 9. Shared Core Files

The following are platform-agnostic and used by both adapters:

```
core/confidence-light.ts     # computeLight() function
core/confidence-state.ts     # ConfidenceState class (ring buffer)
core/self-check.ts           # SelfChecker class
core/event-log.ts            # Structured event logger
core/isolation.ts            # Meta-pattern detection, diagnostic mode, content stripping
```

No platform imports in any of these files. They take signals in, return results out. Pure logic.

---

## 10. Files Created / Modified

### New Files
```
core/confidence-light.ts          # Light scoring algorithm
core/confidence-state.ts          # In-memory rolling window state
core/self-check.ts                # Periodic self-check system
core/event-log.ts                 # Structured event logger with rotation
core/isolation.ts                 # Capture isolation (patterns + diagnostic mode + stripping)
cli/index.ts                      # CLI entry point
cli/status.ts                     # Quick health overview
cli/stats.ts                      # Aggregated statistics
cli/doctor.ts                     # Comprehensive health check
cli/search.ts                     # Memory search
cli/log.ts                        # Event log tail
cli/browse.ts                     # Paginated memory browser
cli/export.ts                     # Memory export
cli/prune.ts                      # Cleanup (includes --meta flag)
cli/light.ts                      # Confidence light inspector
cli/utils/format.ts               # Terminal formatting helpers
cli/utils/parse-log.ts            # Event log streaming parser
cli/utils/ring-buffer.ts          # Ring buffer data structure
tests/core/confidence-light.test.ts
tests/core/confidence-state.test.ts
tests/core/self-check.test.ts
tests/core/event-log.test.ts
tests/core/isolation.test.ts
tests/cli/status.test.ts
tests/cli/stats.test.ts
tests/cli/doctor.test.ts
tests/cli/search.test.ts
tests/cli/prune.test.ts
tests/cli/light.test.ts
tests/integration/observability.test.ts
```

### Modified Files
```
core/omega-client.ts              # Add event logging + confidence state recording
core/config.ts                    # Add observability + isolation config
core/types.ts                     # Add LogEvent, ConfidenceSignals, LightColor types
core/formatter.ts                 # Add light indicator + attribution to injected context
core/sanitize.ts                  # Extend stripping to cover all system content
adapters/claude-code/recall.ts    # Confidence light + self-check + event log + stderr
adapters/claude-code/capture.ts   # Isolation layers + event log + stderr
adapters/claude-code/init.ts      # Health check + confidence state init
adapters/openclaw/recall.ts       # Confidence light + self-check + event log
adapters/openclaw/capture.ts      # Isolation layers + event log
adapters/openclaw/index.ts        # Register diagnostic tools + slash commands
package.json                      # Add "bin" entry, CLI scripts
tsconfig.json                     # Include cli/ in compilation
```

---

## 11. Testing

### Task 17: Confidence Light Tests

```typescript
// Test 1: Green when all signals healthy
// Test 2: Yellow when top_score < 0.3
// Test 3: Yellow when consecutive misses >= 3
// Test 4: Yellow when skip rate > 40%
// Test 5: Yellow when latency > 500ms
// Test 6: Red when OMEGA unreachable
// Test 7: Red when error count > 10
// Test 8: Red when recall query failed
// Test 9: Precedence — red conditions override yellow
// Test 10: Green on first turn (no history)
```

### Task 18: Confidence State Tests

```typescript
// Test 1: Ring buffer wraps correctly at window size
// Test 2: Consecutive miss counter resets on hit
// Test 3: Error window resets after 30 minutes
// Test 4: getSignals() returns correct aggregates
// Test 5: State is in-memory only (no persistence)
```

### Task 19: Isolation Tests

```typescript
// Test 1: Meta-pattern catches "why didn't you remember"
// Test 2: Meta-pattern catches "memory status"
// Test 3: Meta-pattern does NOT catch "remember to use PostgreSQL"
// Test 4: Meta-pattern does NOT catch normal code discussion
// Test 5: Diagnostic mode skips capture
// Test 6: Diagnostic mode auto-clears after timeout
// Test 7: Content stripping removes memory blocks
// Test 8: Content stripping removes confidence indicators
// Test 9: Content stripping preserves normal conversation content
// Test 10: All three layers combined — nothing leaks through
```

### Task 20: Self-Check Tests

```typescript
// Test 1: Check doesn't run before interval
// Test 2: Check runs after N turns
// Test 3: Check runs after time interval
// Test 4: Degraded result injects advisory line
// Test 5: Green result injects nothing extra
// Test 6: Explicit check runs immediately
```

### Task 21: Event Logger Tests

Same as original spec: write format, rotation, non-blocking, graceful degradation, concurrent writes.

### Task 22: CLI Command Tests

Same as original spec, plus `light` command tests.

### Task 23: Integration Tests

```typescript
// Test 1: Full recall cycle → event log has recall_start + omega_call + recall_hit with light
// Test 2: Meta-memory conversation → capture_skipped with reason meta_memory_conversation
// Test 3: Diagnostic mode on → all captures skipped → diagnostic mode off → captures resume
// Test 4: Self-check fires after N turns → self_check event in log
// Test 5: Confidence light degrades → advisory line appears in next recall injection
// Test 6: Confidence light recovers → advisory line disappears
// Test 7: prune --meta finds and removes diagnostic memories
// Test 8: Both adapters produce identical event log format
```

---

## 12. Completion Criteria

ALL of the following must be true before outputting `OBSERVABILITY_COMPLETE`:

1. ✅ Confidence light scoring implemented and tested (green/yellow/red)
2. ✅ Confidence state ring buffer tracks last 50 events per category
3. ✅ Light rendered in both Claude Code and OpenClaw adapter output
4. ✅ Self-check runs periodically, injects advisory only when degraded
5. ✅ Three-layer capture isolation prevents meta-memory pollution
6. ✅ Event logger writes structured JSONL with rotation
7. ✅ All hooks instrumented with event logging and light tracking
8. ✅ CLI commands work: status, stats, doctor, search, log, browse, export, prune, light
9. ✅ Attribution tags in injected context (IDs, source, light in footer)
10. ✅ Stderr output for Claude Code verbose mode
11. ✅ All existing tests pass (no regressions)
12. ✅ All new tests pass (confidence, isolation, self-check, event log, CLI)
13. ✅ TypeScript compiles with zero errors
14. ✅ Git commit: `feat(observability): confidence light, self-check, event log, CLI tools, isolation`
15. ✅ `claude-progress.txt` updated

---

## 13. Build Command for Ralph Wiggum

```
/ralph-loop "Read the observability spec at PHASE1.5-OBSERVABILITY-SPEC.md. Execute tasks in order: (1) Core — confidence-light.ts, confidence-state.ts, self-check.ts, event-log.ts, isolation.ts and their tests. (2) Wiring — instrument both adapters (claude-code + openclaw) with confidence light, event logging, isolation layers, self-check. (3) CLI — all 9 commands (status, stats, doctor, search, log, browse, export, prune, light) with tests. (4) Attribution — update formatter with IDs, source lines, light in footer. (5) Integration tests across both adapters. Fix any failures. Output OBSERVABILITY_COMPLETE only when ALL tests pass and TypeScript compiles with zero errors." --max-iterations 30 --completion-promise "OBSERVABILITY_COMPLETE"
```

---

## 14. Updated Roadmap

```
Phase 1   ✅ Core plugin (OpenClaw adapter)
Phase 1a  ✅ Claude Code adapter  
Phase 1.5 ← YOU ARE HERE — Observability (confidence light, self-check, CLI, isolation)
Phase 2   UDS socket bridge (now has latency baseline from event log!)
Phase 3   MCP server mode
Phase 4   Enhanced intelligence
```
