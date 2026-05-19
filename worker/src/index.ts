import type { ChatRequest, ChatMessage } from "./types";
import {
  type Env,
  loadSession,
  saveSession,
} from "./rag";
import { callLlm, parseLlmResponse } from "./llm";
import { selectSystemMessage } from "./system-messages";
import { ALL_TOOLS } from "./tools";

export { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    let response: Response;

    if (url.pathname === "/chat" && request.method === "POST") {
      response = await handleChat(request, env, ctx);
    } else if (url.pathname === "/chat/history" && request.method === "GET") {
      response = await handleHistory(request, env);
    } else if (url.pathname === "/health" && request.method === "GET") {
      response = await healthCheck(env);
    } else {
      response = new Response("Not found", { status: 404 });
    }

    // Add CORS to all responses
    const headers = corsHeaders();
    for (const [k, v] of Object.entries(headers)) {
      response.headers.set(k, v);
    }
    return response;
  },
};

async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: ChatRequest;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body.message || !body.user_id) {
    return json({ error: "message and user_id are required" }, 400);
  }

  const session = await loadSession(env, body.user_id, body.session_id);
  const sysMsg = await selectSystemMessage(env, body.message);
  const fallback = "You are gAIa, an AI assistant with access to a knowledge base via vector search.";

  const llmConfig = {
    gatewayToken: env.CF_AIG_TOKEN,
    baseUrl: env.LLM_BASE_URL,
    providerSlug: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    apiMode: (env.LLM_API_MODE as "openai" | "anthropic") || "openai",
    maxTokens: env.LLM_MAX_TOKENS ? parseInt(env.LLM_MAX_TOKENS) : undefined,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: sysMsg?.content ?? fallback },
    ...session.messages.slice(-10),
    { role: "user", content: body.message },
  ];

  // Tool loop: LLM decides to search or answer
  for (let i = 0; i < 3; i++) {
    const resp = await callLlm(llmConfig, messages, { stream: false, tools: ALL_TOOLS });
    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: `LLM error (round ${i}): ${resp.status} ${errText}` }, 502);
    }

    const parsed = parseLlmResponse(await resp.json() as Record<string, unknown>);

    if (!parsed.toolCalls?.length) break; // no tools → proceed to final

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: parsed.content ?? "",
      tool_calls: parsed.toolCalls,
    };
    messages.push(assistantMsg);

    for (const tc of parsed.toolCalls) {
      if (tc.name === "search_knowledge_base") {
        const args = JSON.parse(tc.arguments) as { query: string };
        const context = await searchViaDataWorker(env, args.query);
        // Minimax doesn't support role: "tool" — inject results as user message
        messages.push({
          role: "user",
          content: `[Tool result for: ${args.query}]\n${context || "No matching documents found."}`,
        });
      }
    }
  }

  const wantStream = body.stream !== false; // default true
  const usedTools = messages.some((m) => m.role === "user" && m.content?.startsWith("[Tool result"));

  // Streaming only works when no tool messages are present (Minimax limitation)
  if (wantStream && !usedTools) {
    const streamResp = await callLlm(llmConfig, messages, { stream: true });
    if (streamResp.ok) {
      session.messages = messages.filter((m) => m.role !== "system");
      ctx.waitUntil(saveSession(env, session));
      return new Response(streamResp.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Session-Id": session.id,
        },
      });
    }
    // Fall through to non-streaming
  }

  const finalResp = await callLlm(llmConfig, messages, { stream: false, tools: ALL_TOOLS });
  if (!finalResp.ok) {
    const errText = await finalResp.text();
    return json({ error: `LLM error (final): ${finalResp.status} ${errText}` }, 502);
  }

  const finalData = await finalResp.json() as Record<string, unknown>;
  const reply = parseLlmResponse(finalData);

  if (reply.content) {
    messages.push({ role: "assistant", content: reply.content });
  }
  session.messages = messages.filter((m) => m.role !== "system");
  ctx.waitUntil(saveSession(env, session));

  return json({ reply: reply.content, session_id: session.id });
}

async function searchViaDataWorker(env: Env, query: string): Promise<string> {
  const resp = await env.DATA_SERVICE.fetch("https://gaia-data/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) return "";

  const { results } = await resp.json() as {
    results: Array<{ id: string; data: Record<string, unknown>; score: number }>;
  };

  if (!results?.length) return "";

  return results
    .map((r) => `## Source: ${r.data.title ?? "Untitled"} (relevance: ${r.score.toFixed(2)})\n${r.data.canonical ?? JSON.stringify(r.data)}`)
    .join("\n\n");
}

async function handleHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const user_id = url.searchParams.get("user_id");
  const session_id = url.searchParams.get("session_id");
  if (!user_id) return json({ error: "user_id required" }, 400);

  if (session_id) {
    const row = await env.DB.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
      .bind(session_id, user_id).first();
    return json(row ? JSON.parse(row.messages as string) : []);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20",
  ).bind(user_id).all();
  return json(results ?? []);
}

async function healthCheck(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};
  try { await env.DB.prepare("SELECT 1").run(); checks.d1 = "ok"; } catch (e) { checks.d1 = String(e); }
  try {
    const r = await env.DATA_SERVICE.fetch("https://gaia-data/health");
    checks.data_worker = r.ok ? "ok" : `status ${r.status}`;
  } catch (e) { checks.data_worker = String(e); }
  return json(checks, Object.values(checks).every((v) => v === "ok") ? 200 : 500);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
