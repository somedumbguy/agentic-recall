import { classify } from "../lib/classifier.ts";

describe("classifier", () => {
  describe("decision detection", () => {
    it("detects 'we chose' pattern", () => {
      const result = classify("Which database?", "We chose PostgreSQL over MongoDB for ACID compliance.");
      expect(result.type).toBe("decision");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("detects 'let's go with' pattern", () => {
      const result = classify("What framework?", "Let's go with Next.js for the frontend.");
      expect(result.type).toBe("decision");
    });

    it("detects 'decided to' pattern", () => {
      const result = classify("Auth approach?", "We decided to use JWT for authentication.");
      expect(result.type).toBe("decision");
    });

    it("detects 'switching to' pattern", () => {
      const result = classify("Updates?", "We're switching to TypeScript from JavaScript.");
      expect(result.type).toBe("decision");
    });
  });

  describe("lesson detection", () => {
    it("detects 'root cause was' pattern", () => {
      const result = classify("What happened?", "The root cause was a missing index on the users table.");
      expect(result.type).toBe("lesson");
    });

    it("detects 'turns out' pattern", () => {
      const result = classify("Debug result?", "Turns out the issue was a stale cache entry.");
      expect(result.type).toBe("lesson");
    });

    it("detects 'learned that' pattern", () => {
      const result = classify("Takeaway?", "We learned that connection pooling needs explicit limits.");
      expect(result.type).toBe("lesson");
    });
  });

  describe("user_preference detection", () => {
    it("detects 'always use' pattern", () => {
      const result = classify("Remember: always use early returns in my code.", "Got it, I'll use early returns.");
      expect(result.type).toBe("user_preference");
    });

    it("detects 'never' pattern", () => {
      const result = classify("Never use var in JavaScript.", "Understood, I'll use const/let instead.");
      expect(result.type).toBe("user_preference");
    });

    it("detects 'I prefer' pattern", () => {
      const result = classify("I prefer tabs over spaces.", "Noted, I'll use tabs for indentation.");
      expect(result.type).toBe("user_preference");
    });
  });

  describe("error_pattern detection", () => {
    it("detects error message pattern", () => {
      const result = classify("Got this error:", "Error: ECONNRESET when calling the API.");
      expect(result.type).toBe("error_pattern");
    });

    it("detects 'fixed by' pattern", () => {
      const result = classify("How to fix?", "Fixed by increasing the connection pool maxSockets to 50.");
      expect(result.type).toBe("error_pattern");
    });

    it("detects stack trace mention", () => {
      const result = classify("See stack trace:", "The stack trace shows a null pointer in the auth middleware.");
      expect(result.type).toBe("error_pattern");
    });
  });

  describe("general fallback", () => {
    it("returns general for mundane conversation", () => {
      const result = classify("Hello, how are you?", "I'm doing well, thanks for asking!");
      expect(result.type).toBe("general");
      expect(result.confidence).toBeLessThan(0.5);
    });

    it("returns general for ambiguous content", () => {
      const result = classify("Can you help?", "Sure, what do you need help with?");
      expect(result.type).toBe("general");
    });
  });

  describe("extractedFact", () => {
    it("returns non-empty extracted fact", () => {
      const result = classify("Decision?", "We chose Redis for caching.");
      expect(result.extractedFact.length).toBeGreaterThan(0);
    });

    it("caps extracted fact length", () => {
      const longMsg = "x".repeat(1000);
      const result = classify(longMsg, longMsg);
      expect(result.extractedFact.length).toBeLessThanOrEqual(500);
    });
  });
});
