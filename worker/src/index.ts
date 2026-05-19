import type { ChatRequest, ChatMessage } from "./types";
import {
  type Env,
  loadSession,
  saveSession,
  searchVectorize,
  fetchDocuments,
  assembleContext,
} from "./rag";
import { callLlm } from "./llm";
import { selectSystemMessage } from "./system-messages";
import { handleIngest } from "./ingest";

export { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/debug/embed" && request.method === "POST") {
      try {
        const b = await request.json() as { text: string; vid?: string };
        // Option A: embed text and query
        const r = await env.AI.run("@cf/baai/bge-m3", { text: b.text });
        const raw = r as Record<string, unknown>;
        const d = raw.data as unknown[];
        const inner = d[0] as number[];
        const vec = Array.from(inner);
        const qResult = await env.VECTORIZE.query(vec, { topK: 3, returnMetadata: "all" });
        // Option B: query by vector ID (if provided)
        let byIdCount = -1;
        if (b.vid) {
          const idResult = await env.VECTORIZE.query(b.vid, { topK: 3, returnMetadata: "all" });
          byIdCount = (idResult.data as unknown[])?.length ?? 0;
        }
        return json({ embedLen: vec.length, embedFirst3: vec.slice(0, 3), byEmbedCount: (qResult.data as unknown[])?.length ?? 0, byIdCount });
      } catch (e) { return json({ error: String(e) }, 500); }
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return healthCheck(env);
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      return handleIngest(request, env);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env, ctx);
    }

    if (url.pathname === "/chat/history" && request.method === "GET") {
      return handleHistory(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.message || !body.user_id) {
    return json({ error: "message and user_id are required" }, 400);
  }

  // 1. Load or create session
  const session = await loadSession(env, body.user_id, body.session_id);

  // 2. RAG: embed query → search Vectorize → fetch D1 docs → assemble context
  const matches = await searchVectorize(env, body.message);
  const docs = await fetchDocuments(env, matches);
  const ragContext = assembleContext(docs, matches);

  // 3. Select system message
  const sysMsg = await selectSystemMessage(env, body.message);
  const fallback = "You are gAIa, an AI assistant with access to a knowledge base. Answer helpfully and accurately, drawing on provided context when relevant.";
  const ragBlock = ragContext
    ? `\n\n## Knowledge Base Results\nUse the following information to answer. Prioritize these sources over general knowledge. Cite the source title when using information. If none of this information helps, say so.\n\n${ragContext}`
    : "";

  const systemContent = (sysMsg?.content ?? fallback) + ragBlock;

  // 4. Build messages array
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...session.messages.slice(-10),
    { role: "user", content: body.message },
  ];

  // 5. Call LLM with streaming (routes through AI Gateway)
  const llmResp = await callLlm(
    {
      gatewayToken: env.CF_AIG_TOKEN,
      baseUrl: env.LLM_BASE_URL,
      providerSlug: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      apiMode: (env.LLM_API_MODE as "openai" | "anthropic") || "openai",
      maxTokens: env.LLM_MAX_TOKENS ? parseInt(env.LLM_MAX_TOKENS) : undefined,
    },
    messages,
  );

  if (!llmResp.ok) {
    const err = await llmResp.text();
    return json({ error: `LLM error: ${err}` }, 502);
  }

  // 6. Save session — don't block the stream
  session.messages.push({ role: "user", content: body.message });
  ctx.waitUntil(saveSession(env, session));

  // 7. Stream the response
  return new Response(llmResp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Session-Id": session.id,
      "X-RAG-Matches": String(matches.length),
      "X-RAG-Docs": String(docs.length),
    },
  });
}

async function handleHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const user_id = url.searchParams.get("user_id");
  const session_id = url.searchParams.get("session_id");

  if (!user_id) {
    return json({ error: "user_id is required" }, 400);
  }

  if (session_id) {
    const row = await env.DB.prepare(
      "SELECT * FROM sessions WHERE id = ? AND user_id = ?",
    )
      .bind(session_id, user_id)
      .first();
    return json(row ? JSON.parse(row.messages as string) : []);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20",
  )
    .bind(user_id)
    .all();

  return json(results ?? []);
}

async function healthCheck(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};

  try {
    await env.DB.prepare("SELECT 1").run();
    checks.d1 = "ok";
  } catch (e) {
    checks.d1 = `error: ${e}`;
  }

  try {
    const result = await env.AI.run("@cf/baai/bge-m3", { text: "health" });
    const r = result as Record<string, unknown>;
    const d = (r.data as number[][] | number[])?.[0] ?? r.data;
    checks.ai = Array.isArray(d) && (d as number[]).length > 0 ? "ok" : "no vector";
  } catch (e) {
    checks.ai = `error: ${e}`;
  }

  try {
    const result = await env.AI.run("@cf/baai/bge-m3", { text: "health" });
    const r = result as Record<string, unknown>;
    const vec = ((r.data as number[][] | number[])?.[0] ?? r.data) as number[];
    await env.VECTORIZE.query(vec, { topK: 1 });
    checks.vectorize = "ok";
  } catch (e) {
    checks.vectorize = `error: ${e}`;
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return json(checks, allOk ? 200 : 500);
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
