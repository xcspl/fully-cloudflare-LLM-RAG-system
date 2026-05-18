import type { SystemMessage } from "./types";

export interface Env {
  DB: D1Database;
}

const DEFAULT_SLUG = "default";

export async function selectSystemMessage(
  env: Env,
  userMessage: string,
): Promise<SystemMessage | null> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM system_messages ORDER BY priority DESC",
  ).all<SystemMessage>();

  if (!results || results.length === 0) return null;

  const lower = userMessage.toLowerCase();

  for (const row of results) {
    if (!row.triggers) continue;
    try {
      const triggers: string[] = JSON.parse(row.triggers);
      if (triggers.some((t) => lower.includes(t.toLowerCase()))) {
        return row;
      }
    } catch {
      // malformed triggers JSON — skip
    }
  }

  // Fallback to default
  return results.find((r) => r.id === DEFAULT_SLUG) ?? results[0] ?? null;
}
