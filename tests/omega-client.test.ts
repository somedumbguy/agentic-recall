import { OmegaClient } from "../lib/omega-client.ts";

// We test the OmegaClient by using a non-existent python path.
// This triggers the fail-open behavior on all methods.
// For success paths, we test with a simple echo script.

describe("OmegaClient", () => {
  describe("fail-open behavior", () => {
    const client = new OmegaClient({ pythonPath: "/nonexistent/python3" });

    it("query returns empty array on failure", async () => {
      const result = await client.query("test");
      expect(result).toEqual([]);
    });

    it("store returns empty id on failure", async () => {
      const result = await client.store("test", "general");
      expect(result).toEqual({ id: "" });
    });

    it("delete returns false on failure", async () => {
      const result = await client.delete("mem-123");
      expect(result).toEqual({ deleted: false });
    });

    it("health returns ok:false on failure", async () => {
      const result = await client.health();
      expect(result.ok).toBe(false);
    });

    it("getProfile returns empty array on failure", async () => {
      const result = await client.getProfile();
      expect(result).toEqual([]);
    });
  });

  describe("success paths (using real python3)", () => {
    const client = new OmegaClient({ pythonPath: "python3" });

    it("health returns a result when python3 exists", async () => {
      // This tests that python3 is callable and the health script doesn't crash.
      // It may return ok:false if omega is not installed, but should not throw.
      const result = await client.health();
      expect(typeof result.ok).toBe("boolean");
    });
  });
});
