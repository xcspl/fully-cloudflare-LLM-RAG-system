import type { Session, ChatMessage } from "./types";

export interface Env {
  DB: D1Database;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  LLM_API_MODE: string;
  LLM_MAX_TOKENS?: string;
  DATA_SERVICE: Fetcher;
}

export async function loadSession(
  env: Env,
  user_id: string,
  session_id: string,
): Promise<Session> {
  const row = await env.DB.prepare(
    "SELECT * FROM sessions WHERE id = ? AND user_id = ?",
  ).bind(session_id, user_id).first<Session>();
  if (row) return row;

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, messages, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)",
  ).bind(session_id, user_id, now, now).run();

  return { id: session_id, user_id, messages: [], created_at: now, updated_at: now };
}

// Load last N messages from chat_messages table
export async function loadChatHistory(
  env: Env,
  session_id: string,
  limit: number = 50,
): Promise<ChatMessage[]> {
  const { results } = await env.DB.prepare(
    "SELECT role, content, metadata FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
  ).bind(session_id, limit).all<{ role: string; content: string; metadata: string | null }>();

  if (!results?.length) return [];
  return results.reverse().map((r) => {
    const msg: ChatMessage = { role: r.role as ChatMessage["role"], content: r.content };
    if (r.metadata) {
      try {
        const meta = JSON.parse(r.metadata);
        if (meta.tool_calls) msg.tool_calls = meta.tool_calls;
        if (meta.tool_call_id) msg.tool_call_id = meta.tool_call_id;
      } catch {}
    }
    return msg;
  });
}

// Save each message as a row in chat_messages
export async function saveChatMessages(
  env: Env,
  session_id: string,
  user_id: string,
  messages: ChatMessage[],
): Promise<void> {
  // Compactify assistant(tool_calls) → [search: "query"] markers before saving
  const compact = messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      const query = m.tool_calls.map((tc) => {
        try { return JSON.parse(tc.arguments || "{}").query; } catch { return ""; }
      }).filter(Boolean).join(", ");
      return { ...m, content: `[search: ${query}]`, tool_calls: undefined };
    }
    // Strip think blocks from assistant messages
    if (m.role === "assistant" && m.content) {
      const stripped = m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      return { ...m, content: stripped || m.content };
    }
    return m;
  });

  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    "INSERT INTO chat_messages (id, session_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const batch: D1PreparedStatement[] = [];
  for (const m of compact) {
    batch.push(stmt.bind(crypto.randomUUID(), session_id, user_id, m.role, m.content.slice(0, 10000), now));
  }

  // Execute in chunks of 10 (D1 batch limit)
  for (let i = 0; i < batch.length; i += 10) {
    await env.DB.batch(batch.slice(i, i + 10));
  }
}

export async function saveSession(env: Env, session: Session): Promise<void> {
  await env.DB.prepare(
    `UPDATE sessions SET updated_at = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), session.id).run();
}
