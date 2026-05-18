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

export { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return healthCheck(env);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (url.pathname === "/chat/history" && request.method === "GET") {
      return handleHistory(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
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

  // 2. RAG: search Vectorize → fetch D1 docs → assemble context
  const matches = await searchVectorize(env, body.message);
  const docs = await fetchDocuments(env, matches);
  const ragContext = assembleContext(docs);

  // 3. Select system message
  const sysMsg = await selectSystemMessage(env, body.message);
  const systemContent = ragContext
    ? `${sysMsg?.content ?? "You are gAIa, the EarthTeam AI assistant."}\n\nRelevant information:\n${ragContext}`
    : (sysMsg?.content ?? "You are gAIa, the EarthTeam AI assistant.");

  // 4. Build messages array
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...session.messages.slice(-10), // last 10 exchanges as context window
    { role: "user", content: body.message },
  ];

  // 5. Call LLM with streaming (routes through AI Gateway if configured)
  const llmResp = await callLlm(
    {
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
      gatewayToken: env.CF_AI_GATEWAY_TOKEN,
    },
    messages,
  );

  if (!llmResp.ok) {
    const err = await llmResp.text();
    return json({ error: `LLM error: ${err}` }, 502);
  }

  // 6. Save session — don't block the stream
  session.messages.push({ role: "user", content: body.message });
  // assistant reply added to session on next request (after stream completes)

  const ctx = new ExecutionContext();
  ctx.waitUntil(saveSession(env, session));

  // 7. Stream the response
  return new Response(llmResp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Session-Id": session.id,
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
    await env.VECTORIZE.query("health", { topK: 1 });
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
