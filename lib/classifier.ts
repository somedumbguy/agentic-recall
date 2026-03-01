import type { ClassificationResult, MemoryType } from "../types/index.ts";

interface PatternSet {
  type: MemoryType;
  patterns: RegExp[];
  weight: number;
}

const PATTERN_SETS: PatternSet[] = [
  {
    type: "decision",
    weight: 1.0,
    patterns: [
      /we (?:chose|decided|went with|picked|selected)/i,
      /(?:let's|lets) (?:go with|use|stick with)/i,
      /(?:the|our) (?:approach|decision|choice) (?:is|was)/i,
      /(?:going forward|from now on),? (?:we'll|we will)/i,
      /decided (?:to|on|against)/i,
      /(?:switching|migrating|moving) (?:to|from)/i,
    ],
  },
  {
    type: "lesson",
    weight: 0.9,
    patterns: [
      /(?:the |root )?(?:fix|cause|issue|problem|bug) (?:was|is|turned out)/i,
      /(?:learned|discovered|realized|found out) that/i,
      /(?:turns out|it was because|the reason was)/i,
      /(?:workaround|solution|resolution):/i,
      /(?:key takeaway|lesson learned|note to self)/i,
      /(?:the trick is|the key was|what worked was)/i,
    ],
  },
  {
    type: "user_preference",
    weight: 0.85,
    patterns: [
      /(?:always|never) (?:use|do|add|include|write)/i,
      /(?:i |my |we )prefer/i,
      /(?:my style|i like to|i want you to)/i,
      /(?:from now on|going forward|remember):?\s/i,
      /(?:code style|convention|standard|rule):/i,
      /(?:don't|do not|never) (?:use|do|add)/i,
    ],
  },
  {
    type: "error_pattern",
    weight: 0.8,
    patterns: [
      /(?:error|exception|crash|failure|bug|broke):/i,
      /(?:stack trace|traceback|stderr)/i,
      /(?:ECONNRESET|ENOMEM|EACCES|ENOENT|SIGKILL|SIGTERM)/,
      /(?:fixed by|resolved by|patched with)/i,
      /(?:segfault|segmentation fault|out of memory)/i,
      /(?:timeout|deadlock|race condition)/i,
    ],
  },
];

function extractFact(combined: string, type: MemoryType): string {
  const lines = combined.split("\n").filter((l) => l.trim().length > 0);
  // Take first 3 meaningful lines as the extracted fact, capped at 500 chars
  const fact = lines.slice(0, 3).join(" ").slice(0, 500);
  return fact || combined.slice(0, 500);
}

export function classify(userMessage: string, assistantMessage: string): ClassificationResult {
  const combined = `${userMessage}\n${assistantMessage}`;
  const lowerCombined = combined.toLowerCase();

  let bestType: MemoryType = "general";
  let bestScore = 0;

  for (const set of PATTERN_SETS) {
    let matchCount = 0;
    for (const pattern of set.patterns) {
      if (pattern.test(combined)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      const score = (matchCount / set.patterns.length) * set.weight;
      if (score > bestScore) {
        bestScore = score;
        bestType = set.type;
      }
    }
  }

  const confidence = bestType === "general" ? 0.3 : Math.min(0.95, 0.5 + bestScore);

  return {
    type: bestType,
    confidence,
    extractedFact: extractFact(combined, bestType),
  };
}
