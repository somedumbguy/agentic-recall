import {
  sanitizeContent,
  stripInjectedContext,
  stripSystemPrefixes,
  sanitizeFull,
  validateContentLength,
} from "../lib/validate.ts";

describe("sanitizeContent", () => {
  it("removes control characters", () => {
    expect(sanitizeContent("hello\x00world\x07!")).toBe("helloworld!");
  });

  it("preserves newlines and tabs", () => {
    expect(sanitizeContent("hello\n\tworld")).toBe("hello\n\tworld");
  });

  it("removes BOM", () => {
    expect(sanitizeContent("\uFEFFhello")).toBe("hello");
  });

  it("trims whitespace", () => {
    expect(sanitizeContent("  hello  ")).toBe("hello");
  });
});

describe("stripInjectedContext", () => {
  it("removes memory blocks", () => {
    const input = `Before
=== RELEVANT MEMORIES (auto-recalled) ===

[decision | 2 hours ago]
We chose PostgreSQL.

=== END MEMORIES ===
After`;
    expect(stripInjectedContext(input)).toBe("Before\n\nAfter");
  });

  it("returns unchanged if no memory block", () => {
    expect(stripInjectedContext("normal text")).toBe("normal text");
  });
});

describe("stripSystemPrefixes", () => {
  it("removes [SYSTEM] prefix", () => {
    expect(stripSystemPrefixes("[SYSTEM] message")).toBe("message");
  });

  it("removes [CONTEXT] prefix", () => {
    expect(stripSystemPrefixes("[CONTEXT] info")).toBe("info");
  });
});

describe("sanitizeFull", () => {
  it("combines all sanitization steps", () => {
    const input = `[SYSTEM] Before\x00
=== RELEVANT MEMORIES (auto-recalled) ===
memory
=== END MEMORIES ===
After`;
    expect(sanitizeFull(input)).toBe("Before\n\nAfter");
  });
});

describe("validateContentLength", () => {
  it("rejects too-short content", () => {
    const result = validateContentLength("hi", 20, 50000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("too short");
  });

  it("rejects too-long content", () => {
    const result = validateContentLength("x".repeat(60000), 20, 50000);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("too long");
  });

  it("accepts valid content", () => {
    const result = validateContentLength("a".repeat(100), 20, 50000);
    expect(result.valid).toBe(true);
  });

  it("uses custom min/max", () => {
    expect(validateContentLength("short", 3, 10).valid).toBe(true);
    expect(validateContentLength("x".repeat(15), 3, 10).valid).toBe(false);
  });
});
