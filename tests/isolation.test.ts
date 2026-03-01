import { isMetaMemoryConversation, stripMemorySystemContent, shouldSkipCapture, setDiagnosticMode } from "../lib/isolation.ts";

describe("isMetaMemoryConversation", () => {
  it("catches 'why didn't you remember'", () => {
    expect(isMetaMemoryConversation("why didn't you remember that?", "I apologize...")).toBe(true);
  });

  it("catches 'memory status'", () => {
    expect(isMetaMemoryConversation("check memory status", "The memory system is...")).toBe(true);
  });

  it("catches 'how many memories'", () => {
    expect(isMetaMemoryConversation("how many memories are stored?", "There are 847...")).toBe(true);
  });

  it("catches confidence light mentions", () => {
    expect(isMetaMemoryConversation("why is the confidence light yellow?", "The 🟡 indicates...")).toBe(true);
  });

  it("catches agentic-recall doctor", () => {
    expect(isMetaMemoryConversation("run agentic-recall doctor", "Running stats...")).toBe(true);
  });

  it("catches OMEGA error mentions", () => {
    expect(isMetaMemoryConversation("OMEGA is unreachable", "Let me check the status...")).toBe(true);
  });

  it("does NOT catch 'remember to use PostgreSQL'", () => {
    expect(isMetaMemoryConversation("remember to use PostgreSQL", "Sure, I'll use PostgreSQL")).toBe(false);
  });

  it("does NOT catch normal code discussion", () => {
    expect(isMetaMemoryConversation(
      "set up the database connection",
      "Here's the connection config using PostgreSQL with ACID compliance",
    )).toBe(false);
  });

  it("does NOT catch 'what do you think about React?'", () => {
    expect(isMetaMemoryConversation("what do you think about React?", "React is a great library")).toBe(false);
  });
});

describe("stripMemorySystemContent", () => {
  it("removes memory injection blocks", () => {
    const text = "before\n=== RELEVANT MEMORIES (auto-recalled) ===\nsome memory\n=== END MEMORIES ===\nafter";
    expect(stripMemorySystemContent(text)).toBe("before\n\nafter");
  });

  it("removes recall skipped blocks", () => {
    const text = "=== RECALL SKIPPED | OMEGA unreachable ===\nSome content";
    expect(stripMemorySystemContent(text)).toBe("Some content");
  });

  it("removes confidence indicators", () => {
    const text = "Some text\n🟢 4 memories injected (187ms)\nMore text";
    expect(stripMemorySystemContent(text)).toBe("Some text\n\nMore text");
  });

  it("removes source attribution lines", () => {
    const text = "Memory content\nSource: session abc123\nOther content";
    expect(stripMemorySystemContent(text)).toBe("Memory content\n\nOther content");
  });

  it("removes [agentic-recall] system lines", () => {
    const text = "[agentic-recall] captured: decision (0.92)\nNormal content";
    expect(stripMemorySystemContent(text)).toBe("Normal content");
  });

  it("removes memory IDs", () => {
    const text = "Some memory | id: mem_a1b2c3 content";
    expect(stripMemorySystemContent(text)).toBe("Some memory  content");
  });

  it("preserves normal conversation content", () => {
    const text = "Let's set up PostgreSQL.\nUse connection pooling.\nAdd retry logic.";
    expect(stripMemorySystemContent(text)).toBe(text);
  });
});

describe("shouldSkipCapture", () => {
  afterEach(() => {
    setDiagnosticMode(false);
    delete process.env.AGENTIC_RECALL_DIAGNOSTIC;
  });

  it("returns null for normal conversation", () => {
    expect(shouldSkipCapture("set up database", "Here's the config")).toBeNull();
  });

  it("returns meta_memory_conversation for meta discussion", () => {
    expect(shouldSkipCapture("check memory status", "The system is...")).toBe("meta_memory_conversation");
  });

  it("returns diagnostic_mode when flag is set", () => {
    setDiagnosticMode(true);
    expect(shouldSkipCapture("normal prompt", "normal response")).toBe("diagnostic_mode");
  });

  it("returns diagnostic_mode when env var is set", () => {
    process.env.AGENTIC_RECALL_DIAGNOSTIC = "true";
    expect(shouldSkipCapture("normal prompt", "normal response")).toBe("diagnostic_mode");
  });

  it("diagnostic mode takes precedence over meta pattern", () => {
    setDiagnosticMode(true);
    expect(shouldSkipCapture("check memory status", "The system is...")).toBe("diagnostic_mode");
  });
});
