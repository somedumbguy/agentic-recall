import { SelfChecker } from "../lib/self-check.ts";
import type { ConfidenceSignals } from "../types/index.ts";

function makeSignals(overrides: Partial<ConfidenceSignals> = {}): ConfidenceSignals {
  return {
    recallSuccess: true,
    memoriesFound: 5,
    memoriesInjected: 3,
    topScore: 0.85,
    avgScore: 0.7,
    recallLatency: 150,
    recentErrorCount: 0,
    recentSkipRate: 0.1,
    recentRecallMissRate: 0.2,
    consecutiveMisses: 0,
    avgRecentLatency: 180,
    omegaReachable: true,
    lastCaptureAge: 60,
    lastSuccessfulRecall: 30,
    ...overrides,
  };
}

function makeDeps(signals?: Partial<ConfidenceSignals>, healthy: boolean = true) {
  return {
    getSignals: () => makeSignals(signals),
    omegaHealth: async () => healthy,
  };
}

describe("SelfChecker", () => {
  it("does not run before turns/interval threshold", async () => {
    const checker = new SelfChecker(makeDeps(), { turnsPerCheck: 10, checkInterval: 300000 });
    // Only 5 turns
    for (let i = 0; i < 5; i++) {
      const result = await checker.checkIfDue();
      if (i < 9) expect(result).toBeNull();
    }
  });

  it("runs after N turns", async () => {
    const checker = new SelfChecker(makeDeps(), { turnsPerCheck: 3, checkInterval: 9999999 });
    await checker.checkIfDue(); // turn 1
    await checker.checkIfDue(); // turn 2
    const result = await checker.checkIfDue(); // turn 3 — should run
    expect(result).not.toBeNull();
    expect(result!.overall).toBe("green");
  });

  it("runs after time interval", async () => {
    const checker = new SelfChecker(makeDeps(), { turnsPerCheck: 9999, checkInterval: 0 });
    // checkInterval: 0 means always due by time
    const result = await checker.checkIfDue();
    expect(result).not.toBeNull();
  });

  it("runNow runs immediately", async () => {
    const checker = new SelfChecker(makeDeps());
    const result = await checker.runNow();
    expect(result).toBeDefined();
    expect(result.overall).toBe("green");
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it("returns green when all healthy", async () => {
    const checker = new SelfChecker(makeDeps());
    const result = await checker.runNow();
    expect(result.overall).toBe("green");
    expect(result.recommendations).toHaveLength(0);
  });

  it("returns yellow when skip rate is high", async () => {
    const checker = new SelfChecker(makeDeps({ recentSkipRate: 0.5 }));
    const result = await checker.runNow();
    expect(result.overall).toBe("yellow");
    expect(result.checks.find((c) => c.name === "capture_quality")!.status).toBe("warn");
  });

  it("returns red when OMEGA unhealthy", async () => {
    const checker = new SelfChecker(makeDeps({}, false));
    const result = await checker.runNow();
    expect(result.overall).toBe("red");
    expect(result.checks.find((c) => c.name === "omega_reachable")!.status).toBe("fail");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("returns red when error count > 5", async () => {
    const checker = new SelfChecker(makeDeps({ recentErrorCount: 7 }));
    const result = await checker.runNow();
    expect(result.overall).toBe("red");
  });

  it("getLastResult returns cached result", async () => {
    const checker = new SelfChecker(makeDeps());
    expect(checker.getLastResult()).toBeNull();
    await checker.runNow();
    expect(checker.getLastResult()).not.toBeNull();
  });
});
