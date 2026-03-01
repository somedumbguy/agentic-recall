let debugEnabled = false;
let platformLogger: { debug: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } | null = null;

export function initLogger(
  logger?: { debug: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
  debug?: boolean,
): void {
  platformLogger = logger ?? null;
  debugEnabled = debug ?? false;
}

export const log = {
  debug(...args: unknown[]): void {
    if (!debugEnabled) return;
    if (platformLogger) platformLogger.debug("[omega]", ...args);
    else console.debug("[omega]", ...args);
  },
  warn(...args: unknown[]): void {
    if (platformLogger) platformLogger.warn("[omega]", ...args);
    else console.warn("[omega]", ...args);
  },
  error(...args: unknown[]): void {
    if (platformLogger) platformLogger.error("[omega]", ...args);
    else console.error("[omega]", ...args);
  },
};
