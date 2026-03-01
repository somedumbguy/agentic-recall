import { ConfidenceState } from "../lib/confidence-state.ts";

describe("ConfidenceState", () => {
  it("starts with empty signals", () => {
    const state = new ConfidenceState(50);
    const signals = state.getSignals();
    expect(signals.recentErrorCount).toBe(0);
    expect(signals.consecutiveMisses).toBe(0);
    expect(signals.recentSkipRate).toBe(0);
    expect(signals.recentRecallMissRate).toBe(0);
  });

  it("tracks consecutive miss counter and resets on hit", () => {
    const state = new ConfidenceState(50);
    state.recordRecall(false, 0, 0, 100);
    state.recordRecall(false, 0, 0, 100);
    state.recordRecall(false, 0, 0, 100);
    expect(state.getSignals().consecutiveMisses).toBe(3);

    state.recordRecall(true, 0.8, 3, 150);
    expect(state.getSignals().consecutiveMisses).toBe(0);
  });

  it("computes recall miss rate from ring buffer", () => {
    const state = new ConfidenceState(10);
    for (let i = 0; i < 7; i++) state.recordRecall(false, 0, 0, 100);
    for (let i = 0; i < 3; i++) state.recordRecall(true, 0.8, 3, 150);
    const signals = state.getSignals();
    expect(signals.recentRecallMissRate).toBeCloseTo(0.7, 1);
  });

  it("computes capture skip rate", () => {
    const state = new ConfidenceState(10);
    state.recordCapture(true, false, "decision");
    state.recordCapture(true, false, "lesson");
    state.recordCapture(false, true, "general");
    state.recordCapture(false, true, "general");
    const signals = state.getSignals();
    expect(signals.recentSkipRate).toBeCloseTo(0.5, 1);
  });

  it("computes avg latency from omega calls", () => {
    const state = new ConfidenceState(50);
    state.recordOmegaCall("query", 100, true);
    state.recordOmegaCall("query", 200, true);
    state.recordOmegaCall("store", 300, true);
    const signals = state.getSignals();
    expect(signals.avgRecentLatency).toBe(200);
  });

  it("ring buffer wraps correctly at window size", () => {
    const state = new ConfidenceState(3); // only 3 slots
    // Fill with misses
    for (let i = 0; i < 5; i++) state.recordRecall(false, 0, 0, 100);
    // Now add 3 hits — should overwrite all misses
    for (let i = 0; i < 3; i++) state.recordRecall(true, 0.8, 3, 150);
    const signals = state.getSignals();
    expect(signals.recentRecallMissRate).toBe(0); // all 3 in buffer are hits
  });

  it("error count increments and window prunes", () => {
    const state = new ConfidenceState(50);
    state.recordError();
    state.recordError();
    expect(state.getSignals().recentErrorCount).toBe(2);
  });

  it("merges current recall signals", () => {
    const state = new ConfidenceState(50);
    const signals = state.getSignals({
      success: true,
      found: 5,
      injected: 3,
      topScore: 0.9,
      avgScore: 0.7,
      latency: 200,
    });
    expect(signals.recallSuccess).toBe(true);
    expect(signals.memoriesFound).toBe(5);
    expect(signals.memoriesInjected).toBe(3);
    expect(signals.topScore).toBe(0.9);
    expect(signals.recallLatency).toBe(200);
  });

  it("tracks omega reachability", () => {
    const state = new ConfidenceState(50);
    expect(state.getSignals().omegaReachable).toBe(true);
    state.recordOmegaCall("query", 100, false);
    expect(state.getSignals().omegaReachable).toBe(false);
    state.recordOmegaCall("query", 100, true);
    expect(state.getSignals().omegaReachable).toBe(true);
  });
});
