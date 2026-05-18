import type { ChatMessage, Session, VectorizeMatch, Document } from "./types";

export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  LLM_API_KEY: string;
  LLM_BASE_URL: string;
  CF_AI_GATEWAY_TOKEN?: string;
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

export async function searchVectorize(
  env: Env,
  query: string,
  topK: number = 5,
): Promise<VectorizeMatch[]> {
  const { data } = await env.VECTORIZE.query(query, {
    topK,
    returnMetadata: "all",
  });
  return (data as VectorizeMatch[]) ?? [];
}

export async function fetchDocuments(
  env: Env,
  matches: VectorizeMatch[],
): Promise<Document[]> {
  const ids = matches
    .map((m) => m.metadata?.doc_id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM documents WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<Document>();

  return results ?? [];
}

export function assembleContext(docs: Document[]): string {
  if (docs.length === 0) return "";
  return docs
    .map((d) => `[${d.title}]\n${d.raw_content}`)
    .join("\n\n---\n\n");
}
