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
  const fallback = "You are gAIa, the AI assistant for EarthTeam Alliance.";

  // EarthTeam identity — always injected, never from RAG
  const identity = `You are gAIa, the AI assistant for EarthTeam Alliance — a global coalition of 100+ frontline conservation organizations, scientists, and communities united under the Planetary Health approach. You help protect wildlife, preserve habitats, and reform agriculture.

You ARE EarthTeam's AI. Use "we" and "our" when referring to EarthTeam. You know about:
- EarthTeam's three pillars: Wildlife Protection, Habitat Protection, Regenerative Agriculture
- EarthTeam's Solutions Map at map.earth-team.org
- EarthTeam's learning platform at earth-team.org/lms
- Earth Credits (EarthTeam Stars) — the reward system that gives planet protectors a "LIFT"
- Freeland (www.freeland.org) — EarthTeam's host and anchor organization
- The AI Oracle — the AI assistant for verifying conservation projects

You have access to a knowledge base via vector search. Use the search_knowledge_base tool when you need more specific information.`;

  // GMT time with key timezone references
  const now = new Date();
  const gmt = now.toISOString().replace("T", " ").slice(0, 19) + " GMT";
  const temporal = `\n\n[Current time: ${gmt} | Year: ${now.getUTCFullYear()} | Month: ${now.toLocaleString("en-US", { month: "long", timeZone: "UTC" })}]`;

  const llmConfig = {
    gatewayToken: env.CF_AIG_TOKEN,
    baseUrl: env.LLM_BASE_URL,
    providerSlug: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    apiMode: (env.LLM_API_MODE as "openai" | "anthropic") || "openai",
    maxTokens: env.LLM_MAX_TOKENS ? parseInt(env.LLM_MAX_TOKENS) : undefined,
  };

  // Combine identity + time + selected prompt (or fallback)
  const systemContent = identity + temporal + "\n\n" + (sysMsg?.content ?? fallback);

  const cleanHistory = session.messages.slice(-50);

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...cleanHistory,
    { role: "user", content: body.message },
  ];

  // Tool loop: LLM decides to search or answer directly
  for (let i = 0; i < 3; i++) {
    const resp = await callLlm(llmConfig, messages, { stream: false, tools: ALL_TOOLS });
    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: `LLM error (round ${i}): ${resp.status} ${errText}` }, 502);
    }
    const parsed = parseLlmResponse(await resp.json() as Record<string, unknown>);
    if (!parsed.toolCalls?.length) break; // LLM chose to answer

    // Preserve full tool_call structure (Minimax requires index, type, function)
    const assistantMsg: ChatMessage = { role: "assistant", content: parsed.content ?? "", tool_calls: parsed.toolCalls };
    messages.push(assistantMsg);

    for (const tc of parsed.toolCalls) {
      if (tc.name === "search_knowledge_base") {
        const args = JSON.parse(tc.arguments) as { query: string };
        const context = await searchViaDataWorker(env, args.query);
        messages.push({ role: "tool", tool_call_id: tc.id, content: context || "No matching documents found." });
      }
    }
  }

  // Final streaming call (Minimax: stream without tools after tool messages)
  const wantStream = body.stream !== false;
  const usedTools = messages.some((m) => m.role === "tool");

  if (wantStream && !usedTools) {
    const streamResp = await callLlm(llmConfig, messages, { stream: true });
    if (streamResp.ok) {
      session.messages = messages.filter((m) => m.role !== "system");
      ctx.waitUntil(saveSession(env, session));
      return new Response(streamResp.body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Session-Id": session.id },
      });
    }
  }

  // Final call WITHOUT tools — LLM had its chance to search, now it must answer
  const finalResp = await callLlm(llmConfig, messages, { stream: false });
  if (!finalResp.ok) return json({ error: `LLM error: ${finalResp.status} ${await finalResp.text()}` }, 502);

  const finalData = await finalResp.json() as Record<string, unknown>;
  const reply = parseLlmResponse(finalData);
  if (reply.content) messages.push({ role: "assistant", content: reply.content });
  session.messages = messages.filter((m) => m.role !== "system");
  ctx.waitUntil(saveSession(env, session));

  if (!reply.content) {
    const raw = JSON.stringify(finalData).slice(0, 300);
    return json({ error: "Empty response from LLM", raw: raw }, 500);
  }

  return json({ reply: reply.content, session_id: session.id });
}

async function searchViaDataWorker(env: Env, query: string): Promise<string> {
  const resp = await env.DATA_SERVICE.fetch("https://gaia-data/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, scoreThreshold: 0.5 }),
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
