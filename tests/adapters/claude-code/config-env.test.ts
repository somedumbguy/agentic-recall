import { getConfigFromEnv } from "../../../config.ts";

describe("getConfigFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns defaults when no env vars set", () => {
    const cfg = getConfigFromEnv();
    expect(cfg.autoRecall).toBe(true);
    expect(cfg.autoCapture).toBe(true);
    expect(cfg.maxRecallResults).toBe(10);
    expect(cfg.recallMinScore).toBe(0.3);
    expect(cfg.dualSave).toBe(true);
    expect(cfg.debug).toBe(false);
    expect(cfg.pythonPath).toBe("python3");
  });

  it("respects AGENTIC_RECALL_AUTO_RECALL=false", () => {
    process.env.AGENTIC_RECALL_AUTO_RECALL = "false";
    const cfg = getConfigFromEnv();
    expect(cfg.autoRecall).toBe(false);
  });

  it("respects AGENTIC_RECALL_AUTO_CAPTURE=false", () => {
    process.env.AGENTIC_RECALL_AUTO_CAPTURE = "false";
    const cfg = getConfigFromEnv();
    expect(cfg.autoCapture).toBe(false);
  });

  it("respects AGENTIC_RECALL_MAX_RESULTS", () => {
    process.env.AGENTIC_RECALL_MAX_RESULTS = "5";
    const cfg = getConfigFromEnv();
    expect(cfg.maxRecallResults).toBe(5);
  });

  it("respects AGENTIC_RECALL_MIN_SCORE", () => {
    process.env.AGENTIC_RECALL_MIN_SCORE = "0.5";
    const cfg = getConfigFromEnv();
    expect(cfg.recallMinScore).toBe(0.5);
  });

  it("respects AGENTIC_RECALL_CAPTURE_MODE=smart", () => {
    process.env.AGENTIC_RECALL_CAPTURE_MODE = "smart";
    const cfg = getConfigFromEnv();
    expect(cfg.captureMode).toBe("smart");
  });

  it("respects AGENTIC_RECALL_DUAL_SAVE=false", () => {
    process.env.AGENTIC_RECALL_DUAL_SAVE = "false";
    const cfg = getConfigFromEnv();
    expect(cfg.dualSave).toBe(false);
  });

  it("respects AGENTIC_RECALL_DEBUG=true", () => {
    process.env.AGENTIC_RECALL_DEBUG = "true";
    const cfg = getConfigFromEnv();
    expect(cfg.debug).toBe(true);
  });

  it("respects AGENTIC_RECALL_PYTHON_PATH", () => {
    process.env.AGENTIC_RECALL_PYTHON_PATH = "/usr/local/bin/python3.11";
    const cfg = getConfigFromEnv();
    expect(cfg.pythonPath).toBe("/usr/local/bin/python3.11");
  });

  it("respects AGENTIC_RECALL_DB_PATH", () => {
    process.env.AGENTIC_RECALL_DB_PATH = "/custom/path/omega.db";
    const cfg = getConfigFromEnv();
    expect(cfg.dbPath).toBe("/custom/path/omega.db");
  });
});
