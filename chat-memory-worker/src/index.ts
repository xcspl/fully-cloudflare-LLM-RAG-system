// gaia-chat-memory — Standalone Worker for chat summary RAG.
// Stores and retrieves per-user chat summaries with user isolation.

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
}

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const SUMMARIZE_PROMPT = `Summarize this conversation into a concise, fact-dense paragraph. Capture key topics, decisions, and information shared. Output only the summary.`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/summarize" && request.method === "POST") {
      return handleSummarize(request, env);
    }

    if (url.pathname === "/search" && request.method === "POST") {
      return handleSearch(request, env);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return healthCheck(env);
    }

    return new Response("Not found", { status: 404 });
  },
};

// POST /summarize { user_id, messages: [{role, content}] }
async function handleSummarize(request: Request, env: Env): Promise<Response> {
  let body: { user_id: string; messages: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.user_id || !body.messages?.length) {
    return json({ error: "user_id and messages required" }, 400);
  }

  // 1. Summarize via LLM
  const summary = await summarizeConversation(env, body.messages);
  if (!summary) {
    return json({ error: "Summarization failed" }, 500);
  }

  // 2. Embed summary
  const embedResult = await env.AI.run(EMBEDDING_MODEL, { text: summary });
  const vector = (embedResult as { data: number[] }).data;

  // 3. Store in D1
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO chat_summaries (id, user_id, data, embedding_model, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(
    id,
    body.user_id,
    JSON.stringify({ summary, msg_count: body.messages.length }),
    "embeddings-bge-m3",
    now,
  ).run();

  // 4. Store in Vectorize with user_id in metadata
  await env.VECTORIZE.upsert([{
    id,
    values: vector,
    metadata: {
      canonical_text: summary,
      d1_db_id: "gaia-db",
      d1_row_id: id,
      user_id: body.user_id,
      embedding_model: "embeddings-bge-m3",
    },
  }]);

  return json({ id, summary }, 201);
}

// POST /search { user_id, query }
async function handleSearch(request: Request, env: Env): Promise<Response> {
  let body: { user_id: string; query: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.user_id || !body.query) {
    return json({ error: "user_id and query required" }, 400);
  }

  // Embed query
  const embedResult = await env.AI.run(EMBEDDING_MODEL, { text: body.query });
  const queryVector = (embedResult as { data: number[] }).data;

  // Search Vectorize (fetch extra to compensate for user filter)
  const { data } = await env.VECTORIZE.query(queryVector, {
    topK: 10,
    returnMetadata: "all",
  });

  const matches = (data as Array<{
    id: string;
    score: number;
    metadata?: { d1_row_id: string; user_id: string; canonical_text: string };
  }>) ?? [];

  // Filter by user_id
  const userMatches = matches.filter(
    (m) => m.metadata?.user_id === body.user_id,
  ).slice(0, 5);

  if (userMatches.length === 0) return json({ results: [] });

  // Fetch from D1
  const ids = userMatches.map((m) => m.metadata!.d1_row_id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM chat_summaries WHERE id IN (${placeholders})`,
  ).bind(...ids).all();

  return json({
    results: (results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      data: JSON.parse(r.data as string),
    })),
  });
}

async function summarizeConversation(
  env: Env,
  messages: ChatMessage[],
): Promise<string | null> {
  const convo = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const resp = await fetch(
    `${env.LLM_BASE_URL}/${env.LLM_PROVIDER}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [
          { role: "system", content: SUMMARIZE_PROMPT },
          { role: "user", content: convo },
        ],
        stream: false,
      }),
    },
  );

  if (!resp.ok) return null;

  const data = (await resp.json()) as {
    choices: [{ message: { content: string } }];
  };
  return data.choices[0].message.content.trim();
}

async function healthCheck(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};
  try {
    await env.DB.prepare("SELECT 1").run();
    checks.d1 = "ok";
  } catch (e) { checks.d1 = `error: ${e}`; }
  try {
    const r = await env.AI.run(EMBEDDING_MODEL, { text: "health" });
    checks.ai = (r as { data: number[] }).data.length > 0 ? "ok" : "no vector";
  } catch (e) { checks.ai = `error: ${e}`; }
  try {
    await env.VECTORIZE.query([0.1], { topK: 1 });
    checks.vectorize = "ok";
  } catch (e) { checks.vectorize = `error: ${e}`; }
  return json(checks, Object.values(checks).every((v) => v === "ok") ? 200 : 500);
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
