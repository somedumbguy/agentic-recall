import { jest } from "@jest/globals";
import { handleInit } from "../../../adapters/claude-code/init.ts";

describe("Claude Code init hook", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not throw even if OMEGA is not installed", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(handleInit()).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  it("logs warning when OMEGA is not found", async () => {
    process.env.AGENTIC_RECALL_PYTHON_PATH = "/nonexistent/python3";
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await handleInit();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("OMEGA not found"),
    );

    errorSpy.mockRestore();
  });
});
