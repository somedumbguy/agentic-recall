import { computeLight } from "../lib/confidence-light.ts";
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

describe("computeLight", () => {
  it("green when all signals healthy", () => {
    expect(computeLight(makeSignals()).color).toBe("green");
  });

  it("green on first turn (no history)", () => {
    const result = computeLight(makeSignals({
      memoriesFound: 0, memoriesInjected: 0, topScore: 0, avgScore: 0,
      lastCaptureAge: 0, lastSuccessfulRecall: 0,
    }));
    expect(result.color).toBe("green");
  });

  // RED conditions
  it("red when OMEGA unreachable", () => {
    const result = computeLight(makeSignals({ omegaReachable: false }));
    expect(result.color).toBe("red");
    expect(result.reason).toContain("unreachable");
  });

  it("red when error count > 10", () => {
    const result = computeLight(makeSignals({ recentErrorCount: 12 }));
    expect(result.color).toBe("red");
    expect(result.reason).toContain("errors");
  });

  it("red when recall query failed", () => {
    const result = computeLight(makeSignals({ recallSuccess: false }));
    expect(result.color).toBe("red");
    expect(result.reason).toContain("recall query failed");
  });

  it("red when no activity in 1+ hour", () => {
    const result = computeLight(makeSignals({ lastCaptureAge: 4000, lastSuccessfulRecall: 4000 }));
    expect(result.color).toBe("red");
    expect(result.reason).toContain("no activity");
  });

  // YELLOW conditions
  it("yellow when topScore < 0.3 with results", () => {
    const result = computeLight(makeSignals({ topScore: 0.2, memoriesFound: 3 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("low relevance");
  });

  it("yellow when consecutive misses >= 3", () => {
    const result = computeLight(makeSignals({ memoriesInjected: 0, consecutiveMisses: 4 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("consecutive misses");
  });

  it("yellow when skip rate > 40%", () => {
    const result = computeLight(makeSignals({ recentSkipRate: 0.5 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("skip rate");
  });

  it("yellow when recall miss rate > 60%", () => {
    const result = computeLight(makeSignals({ recentRecallMissRate: 0.7 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("hit rate");
  });

  it("yellow when recall latency > 1000ms", () => {
    const result = computeLight(makeSignals({ recallLatency: 1200 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("slow recall");
  });

  it("yellow when avg latency > 500ms", () => {
    const result = computeLight(makeSignals({ avgRecentLatency: 600 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("latency elevated");
  });

  it("yellow when error count > 3", () => {
    const result = computeLight(makeSignals({ recentErrorCount: 5 }));
    expect(result.color).toBe("yellow");
    expect(result.reason).toContain("recent errors");
  });

  // Precedence
  it("red conditions override yellow", () => {
    const result = computeLight(makeSignals({
      omegaReachable: false,   // red
      recentSkipRate: 0.9,     // yellow
      recallLatency: 2000,     // yellow
    }));
    expect(result.color).toBe("red");
  });
});
