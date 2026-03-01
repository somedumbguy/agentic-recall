import type { SelfCheckResult, CheckResult, LightColor, ConfidenceSignals } from "../types/index.ts";

export interface SelfCheckDeps {
  getSignals: () => ConfidenceSignals;
  omegaHealth: () => Promise<boolean>;
}

/**
 * Periodic self-check system. Runs deeper health analysis on a schedule
 * (every N turns or M minutes). Results are used to surface advisory lines.
 */
export class SelfChecker {
  private lastCheckTime: number = Date.now();
  private lastResult: SelfCheckResult | null = null;
  private turnsSinceCheck: number = 0;
  private checkInterval: number;
  private turnsPerCheck: number;

  constructor(
    private deps: SelfCheckDeps,
    options?: { checkInterval?: number; turnsPerCheck?: number },
  ) {
    this.checkInterval = options?.checkInterval ?? 300000; // 5 minutes
    this.turnsPerCheck = options?.turnsPerCheck ?? 25;
  }

  /**
   * Called on every recall. Returns result if check was due, null otherwise.
   */
  async checkIfDue(): Promise<SelfCheckResult | null> {
    this.turnsSinceCheck++;

    const timeSinceCheck = Date.now() - this.lastCheckTime;
    const turnsDue = this.turnsSinceCheck >= this.turnsPerCheck;
    const timeDue = timeSinceCheck >= this.checkInterval;

    if (!turnsDue && !timeDue) return null;

    return this.runNow();
  }

  /**
   * Run self-check immediately (used by explicit doctor/diagnostic commands).
   */
  async runNow(): Promise<SelfCheckResult> {
    this.turnsSinceCheck = 0;
    this.lastCheckTime = Date.now();
    this.lastResult = await this.runChecks();
    return this.lastResult;
  }

  getLastResult(): SelfCheckResult | null {
    return this.lastResult;
  }

  private async runChecks(): Promise<SelfCheckResult> {
    const checks: CheckResult[] = [];
    const recommendations: string[] = [];

    // 1. OMEGA reachability
    try {
      const healthy = await this.deps.omegaHealth();
      checks.push({
        name: "omega_reachable",
        status: healthy ? "pass" : "fail",
        message: healthy ? "OMEGA responding" : "OMEGA unreachable",
      });
      if (!healthy) recommendations.push("Check OMEGA installation: omega doctor");
    } catch {
      checks.push({ name: "omega_reachable", status: "fail", message: "Health check threw error" });
      recommendations.push("OMEGA may need reinstalling: pip install omega-memory");
    }

    // 2-5. Signal-based checks
    const signals = this.deps.getSignals();

    // 2. Capture health
    if (signals.recentSkipRate > 0.4) {
      checks.push({
        name: "capture_quality",
        status: "warn",
        message: `${(signals.recentSkipRate * 100).toFixed(0)}% of turns skipped`,
      });
      recommendations.push("High skip rate — conversations may be too short or trivial for capture");
    } else {
      checks.push({ name: "capture_quality", status: "pass", message: "Capture rate healthy" });
    }

    // 3. Recall relevance
    if (signals.recentRecallMissRate > 0.6) {
      checks.push({
        name: "recall_relevance",
        status: "warn",
        message: `${((1 - signals.recentRecallMissRate) * 100).toFixed(0)}% hit rate`,
      });
      recommendations.push("Low recall hit rate — memories may not match current work context");
    } else {
      checks.push({ name: "recall_relevance", status: "pass", message: "Recall relevance healthy" });
    }

    // 4. Latency
    if (signals.avgRecentLatency > 500) {
      checks.push({
        name: "latency",
        status: "warn",
        message: `${signals.avgRecentLatency.toFixed(0)}ms average`,
      });
      recommendations.push("Elevated latency — consider UDS socket bridge (Phase 2)");
    } else {
      checks.push({
        name: "latency",
        status: "pass",
        message: `${signals.avgRecentLatency.toFixed(0)}ms average`,
      });
    }

    // 5. Error rate
    if (signals.recentErrorCount > 5) {
      checks.push({
        name: "error_rate",
        status: "fail",
        message: `${signals.recentErrorCount} errors in 30min`,
      });
      recommendations.push("Multiple OMEGA errors — check omega doctor and event log");
    } else if (signals.recentErrorCount > 0) {
      checks.push({
        name: "error_rate",
        status: "warn",
        message: `${signals.recentErrorCount} errors in 30min`,
      });
    } else {
      checks.push({ name: "error_rate", status: "pass", message: "No recent errors" });
    }

    const hasFail = checks.some((c) => c.status === "fail");
    const hasWarn = checks.some((c) => c.status === "warn");
    const overall: LightColor = hasFail ? "red" : hasWarn ? "yellow" : "green";

    return { overall, checks, recommendations };
  }
}
