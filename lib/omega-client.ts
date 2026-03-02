import { execFile } from "child_process";
import { promisify } from "util";
import type { OmegaMemory, OmegaStoreResult, OmegaDeleteResult, OmegaHealthResult, OmegaConfig } from "../types/index.ts";
import { log } from "../logger.ts";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 5000;

function escapeForPython(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

async function runPython(pythonPath: string, script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(pythonPath, ["-c", script], {
      timeout: TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Python subprocess failed:", msg);
    throw err;
  }
}

export class OmegaClient {
  private pythonPath: string;

  constructor(config: Pick<OmegaConfig, "pythonPath">) {
    this.pythonPath = config.pythonPath;
  }

  async query(text: string, options?: { type?: string; limit?: number }): Promise<OmegaMemory[]> {
    const limit = options?.limit ?? 10;
    const escaped = escapeForPython(text);
    const typeFilter = options?.type ? `, event_type='${escapeForPython(options.type)}'` : "";

    const script = `
import json
from omega import query_structured
results = query_structured('${escaped}', limit=${limit}${typeFilter})
print(json.dumps([{
  'id': str(r.get('id', '')),
  'content': str(r.get('content', '')),
  'type': str(r.get('event_type', 'general')),
  'score': float(r.get('relevance', 0)),
  'created_at': str(r.get('created_at', '')),
  'accessed_count': int(r.get('metadata', {}).get('accessed_count', 0)),
  'tags': list(r.get('tags', []) or [])
} for r in results]))
`;
    try {
      const stdout = await runPython(this.pythonPath, script);
      return JSON.parse(stdout) as OmegaMemory[];
    } catch {
      return []; // fail-open
    }
  }

  async store(content: string, type: string, metadata?: Record<string, unknown>): Promise<OmegaStoreResult> {
    const escaped = escapeForPython(content);
    const typeEscaped = escapeForPython(type);

    const script = `
import json, re
from omega import store
result = store('${escaped}', event_type='${typeEscaped}')
if isinstance(result, dict):
    mid = str(result.get('id', result.get('memory_id', '')))
elif isinstance(result, str):
    m = re.search(r'Node ID.*?[\x60]([^\x60]+)[\x60]', result)
    mid = m.group(1) if m else ''
else:
    mid = ''
print(json.dumps({'id': mid}))
`;
    try {
      const stdout = await runPython(this.pythonPath, script);
      return JSON.parse(stdout) as OmegaStoreResult;
    } catch {
      return { id: "" }; // fail-open
    }
  }

  async delete(id: string): Promise<OmegaDeleteResult> {
    const escaped = escapeForPython(id);

    const script = `
import json
from omega import delete_memory
result = delete_memory('${escaped}')
print(json.dumps({'deleted': bool(result)}))
`;
    try {
      const stdout = await runPython(this.pythonPath, script);
      return JSON.parse(stdout) as OmegaDeleteResult;
    } catch {
      return { deleted: false }; // fail-open
    }
  }

  async getProfile(): Promise<OmegaMemory[]> {
    return this.query("user preferences and style", { type: "user_preference", limit: 20 });
  }

  async health(): Promise<OmegaHealthResult> {
    const script = `
import json
try:
    from omega import query_structured
    results = query_structured('health check', limit=1)
    print(json.dumps({'ok': True, 'memoryCount': 0, 'dbSize': 'unknown'}))
except Exception as e:
    print(json.dumps({'ok': False, 'memoryCount': 0, 'dbSize': str(e)}))
`;
    try {
      const stdout = await runPython(this.pythonPath, script);
      return JSON.parse(stdout) as OmegaHealthResult;
    } catch {
      return { ok: false, memoryCount: 0, dbSize: "unreachable" };
    }
  }
}
