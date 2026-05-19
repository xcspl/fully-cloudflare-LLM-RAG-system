import type { Session } from "./types";

export interface Env {
  DB: D1Database;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  LLM_API_MODE: string;
  LLM_MAX_TOKENS?: string;
  DATA_SERVICE: Fetcher;  // Service binding to gaia-data
}

export async function loadSession(
  env: Env,
  user_id: string,
  session_id?: string,
): Promise<Session> {
  if (session_id) {
    const row = await env.DB.prepare(
      "SELECT * FROM sessions WHERE id = ? AND user_id = ?",
    )
      .bind(session_id, user_id)
      .first<Session>();

    if (row) {
      row.messages = JSON.parse(row.messages as unknown as string);
      return row;
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    user_id,
    messages: [],
    created_at: now,
    updated_at: now,
  };
}

export async function saveSession(env: Env, session: Session): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, messages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       messages = excluded.messages,
       updated_at = excluded.updated_at`,
  )
    .bind(
      session.id,
      session.user_id,
      JSON.stringify(session.messages),
      session.created_at,
      new Date().toISOString(),
    )
    .run();
}
