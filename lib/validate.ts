const MEMORY_BLOCK_RE = /=== RELEVANT MEMORIES \(auto-recalled\) ===[\s\S]*?=== END MEMORIES ===/g;
const SYSTEM_PREFIX_RE = /^\[(SYSTEM|CONTEXT)\]\s*/gm;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFF0-\uFFFF\uFEFF]/g;

export function sanitizeContent(content: string): string {
  return content.replace(CONTROL_CHARS_RE, "").trim();
}

export function stripInjectedContext(content: string): string {
  return content.replace(MEMORY_BLOCK_RE, "").trim();
}

export function stripSystemPrefixes(content: string): string {
  return content.replace(SYSTEM_PREFIX_RE, "").trim();
}

export function sanitizeFull(content: string): string {
  let result = stripInjectedContext(content);
  result = stripSystemPrefixes(result);
  result = sanitizeContent(result);
  return result;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateContentLength(
  content: string,
  min: number = 20,
  max: number = 50000,
): ValidationResult {
  if (content.length < min) {
    return { valid: false, reason: `Content too short (${content.length} < ${min})` };
  }
  if (content.length > max) {
    return { valid: false, reason: `Content too long (${content.length} > ${max})` };
  }
  return { valid: true };
}
