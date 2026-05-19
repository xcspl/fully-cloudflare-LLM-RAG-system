import type { ChatMessage, Session, VectorizeMatch, Document, DocumentData } from "./types";

export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  LLM_API_MODE: string;
  LLM_MAX_TOKENS?: string;
  CANON_PROVIDER: string;  // "custom-deep2"
  CANON_MODEL: string;     // "deepseek-v4-flash"
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
  // Embed query via Workers AI bge-m3
  const embedResult = await env.AI.run("@cf/baai/bge-m3", { text: query });
  const raw = embedResult as { data: unknown };
  // data is nested: [[n1, n2, ...]] — extract inner array and convert to plain number[]
  const inner = (raw.data as unknown[][])[0];
  const queryVector: number[] = Array.from(inner as Iterable<number>);

  const result = await env.VECTORIZE.query(queryVector, {
    topK,
    returnMetadata: "all",
  });
  return (result.matches as VectorizeMatch[]) ?? [];
}

export async function fetchDocuments(
  env: Env,
  matches: VectorizeMatch[],
): Promise<Document[]> {
  const ids = matches
    .map((m) => m.metadata?.d1_row_id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM documents WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<Omit<Document, "data"> & { data: string }>();

  return (results ?? []).map((row) => ({
    ...row,
    data: JSON.parse(row.data) as DocumentData,
  }));
}

export function assembleContext(
  docs: Document[],
  matches: VectorizeMatch[],
): string {
  if (docs.length === 0 && matches.length === 0) return "";

  const parts: string[] = [];

  for (const d of docs) {
    parts.push(
      `## Source: ${d.data.title}\n${d.data.raw_content ?? d.data.canonical}`,
    );
  }

  // Fallback: use canonical_text from Vectorize metadata for matches without D1 rows
  for (const m of matches) {
    if (m.metadata?.canonical_text && !docs.some((d) => d.id === m.metadata?.d1_row_id)) {
      parts.push(
        `## Source: vector match (relevance: ${m.score.toFixed(2)})\n${m.metadata.canonical_text}`,
      );
    }
  }

  return parts.join("\n\n");
}
