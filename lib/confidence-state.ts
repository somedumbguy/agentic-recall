import { RingBuffer } from "./ring-buffer.ts";
import type {
  ConfidenceSignals,
  RecallEvent,
  CaptureEvent,
  OmegaCallEvent,
} from "../types/index.ts";

const ERROR_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * In-memory rolling window state for confidence light signals.
 * NOT persisted to disk. Each session starts fresh.
 */
export class ConfidenceState {
  private recallEvents: RingBuffer<RecallEvent>;
  private captureEvents: RingBuffer<CaptureEvent>;
  private omegaCalls: RingBuffer<OmegaCallEvent>;
  private errorCount: number = 0;
  private errorWindowStart: number = Date.now();
  private consecutiveMisses: number = 0;
  private lastCaptureTime: number = 0;
  private lastRecallHitTime: number = 0;
  private _omegaReachable: boolean = true;

  constructor(windowSize: number = 50) {
    this.recallEvents = new RingBuffer(windowSize);
    this.captureEvents = new RingBuffer(windowSize);
    this.omegaCalls = new RingBuffer(windowSize);
  }

  recordRecall(hit: boolean, topScore: number, count: number, latency: number): void {
    this.recallEvents.push({ hit, topScore, count, latency, timestamp: Date.now() });
    if (hit) {
      this.consecutiveMisses = 0;
      this.lastRecallHitTime = Date.now();
    } else {
      this.consecutiveMisses++;
    }
  }

  recordCapture(stored: boolean, skipped: boolean, type: string): void {
    this.captureEvents.push({ stored, skipped, type, timestamp: Date.now() });
    if (stored) {
      this.lastCaptureTime = Date.now();
    }
  }

  recordOmegaCall(method: string, latency: number, success: boolean): void {
    this.omegaCalls.push({ method, latency, success, timestamp: Date.now() });
    this._omegaReachable = success;
  }

  recordError(): void {
    this.pruneErrorWindow();
    this.errorCount++;
  }

  setOmegaReachable(reachable: boolean): void {
    this._omegaReachable = reachable;
  }

  getSignals(currentRecall?: {
    success: boolean;
    found: number;
    injected: number;
    topScore: number;
    avgScore: number;
    latency: number;
  }): ConfidenceSignals {
    this.pruneErrorWindow();

    const recalls = this.recallEvents.toArray();
    const captures = this.captureEvents.toArray();
    const calls = this.omegaCalls.toArray();

    const recallMisses = recalls.filter((r) => !r.hit).length;
    const captureSkips = captures.filter((c) => c.skipped).length;
    const callLatencies = calls.filter((c) => c.success).map((c) => c.latency);
    const avgRecentLatency =
      callLatencies.length > 0
        ? callLatencies.reduce((a, b) => a + b, 0) / callLatencies.length
        : 0;

    const now = Date.now();

    return {
      recallSuccess: currentRecall?.success ?? true,
      memoriesFound: currentRecall?.found ?? 0,
      memoriesInjected: currentRecall?.injected ?? 0,
      topScore: currentRecall?.topScore ?? 0,
      avgScore: currentRecall?.avgScore ?? 0,
      recallLatency: currentRecall?.latency ?? 0,

      recentErrorCount: this.errorCount,
      recentSkipRate: captures.length > 0 ? captureSkips / captures.length : 0,
      recentRecallMissRate: recalls.length > 0 ? recallMisses / recalls.length : 0,
      consecutiveMisses: this.consecutiveMisses,
      avgRecentLatency,

      omegaReachable: this._omegaReachable,
      lastCaptureAge: this.lastCaptureTime > 0 ? (now - this.lastCaptureTime) / 1000 : 0,
      lastSuccessfulRecall: this.lastRecallHitTime > 0 ? (now - this.lastRecallHitTime) / 1000 : 0,
    };
  }

  private pruneErrorWindow(): void {
    if (Date.now() - this.errorWindowStart > ERROR_WINDOW_MS) {
      this.errorCount = 0;
      this.errorWindowStart = Date.now();
    }
  }
}
