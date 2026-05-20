import type { ChatRequest, ChatMessage } from "./types";
import {
  type Env,
  loadSession,
  saveSession,
  loadChatHistory,
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
  if (!body.message || !body.session_id) {
    return json({ error: "message and session_id are required" }, 400);
  }

  const userId = body.user_id || "";
  const session = await loadSession(env, userId, body.session_id);
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

  const cleanHistory = await loadChatHistory(env, session.id, 50);

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...cleanHistory,
    { role: "user", content: body.message },
  ];

  // Save user message immediately
  ctx.waitUntil(saveMessage(env, session.id, userId, "user", body.message));

  // Tool loop: LLM decides to search or answer directly
  toolLoop: for (let i = 0; i < 3; i++) {
    const resp = await callLlm(llmConfig, messages, { stream: false, tools: ALL_TOOLS });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[gAIa] Tool round ${i} failed: ${resp.status} ${errText}`);
      return json({ error: `LLM error (round ${i}/${3}): ${resp.status} ${errText}` }, 502);
    }
    const parsed = parseLlmResponse(await resp.json() as Record<string, unknown>);
    if (!parsed.toolCalls?.length) break; // LLM chose to answer

    // Preserve full tool_call structure (Minimax requires index, type, function)
    const assistantMsg: ChatMessage = { role: "assistant", content: parsed.content ?? "", tool_calls: parsed.toolCalls };
    messages.push(assistantMsg);
    const q = parsed.toolCalls.map((tc) => {
      try { return JSON.parse(tc.arguments || "{}").query; } catch { return ""; }
    }).filter(Boolean).join(", ") || "unknown";
    await saveMessage(env, session.id, userId, "tool", `[Searched knowledge base: ${q}]`);

    for (const tc of parsed.toolCalls) {
      if (tc.name === "search_knowledge_base") {
        const args = JSON.parse(tc.arguments || "{}") as { query: string };
        const context = await searchViaDataWorker(env, args.query);
        const result = context || "No matching documents in the knowledge base. Answer from your own knowledge or tell the user.";
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        // If no results, break tool loop — don't let LLM retry endlessly
        if (!context) break toolLoop;
      } else if (tc.name === "get_current_time") {
        const now = new Date();
        const gmt = now.toISOString().replace("T", " ").slice(0, 19) + " GMT";
        const timeContent = `Current time: ${gmt} | Year: ${now.getUTCFullYear()} | Month: ${now.toLocaleString("en-US", { month: "long", timeZone: "UTC" })}`;
        messages.push({ role: "tool", tool_call_id: tc.id, content: timeContent });
      } else if (tc.name === "search_chat_history") {
        const args = JSON.parse(tc.arguments || "{}") as { query: string };
        const history = await searchChatHistory(env, session.id, args.query);
        const historyContent = history || "No matching past conversations found.";
        messages.push({ role: "tool", tool_call_id: tc.id, content: historyContent });
      }
    }
  }

  // Final streaming call (Minimax: stream without tools after tool messages)
  const wantStream = body.stream !== false;
  const usedTools = messages.some((m) => m.role === "tool");
  const msgCount = messages.length;

  if (wantStream && !usedTools) {
    const streamResp = await callLlm(llmConfig, messages, { stream: true });
    if (streamResp.ok && streamResp.body) {
      ctx.waitUntil(saveSession(env, session));
      const [clientStream, saveStream] = streamResp.body.tee();
      ctx.waitUntil((async () => {
        const reader = saveStream.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
        }
        const visible = raw.split("\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => { try { return JSON.parse(l.slice(6)).choices?.[0]?.delta?.content || ""; } catch { return ""; } })
          .join("");
        if (visible.trim()) {
          const stripped = visible.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          if (stripped) await saveMessage(env, session.id, userId, "assistant", stripped);
        }
      })());
      return new Response(clientStream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Session-Id": session.id },
      });
    }
  }

  // Final call — include tools if they were used (Minimax requires this)
  const finalResp = await callLlm(llmConfig, messages, { stream: false, tools: usedTools ? ALL_TOOLS : undefined });
  if (!finalResp.ok) {
    const errText = await finalResp.text();
    console.error(`[gAIa] Final call failed: ${finalResp.status} ${errText} (tools=${usedTools}, msgs=${msgCount})`);
    return json({ error: `LLM error (final, tools=${usedTools}, msgs=${msgCount}): ${finalResp.status} ${errText}` }, 502);
  }

  const finalData = await finalResp.json() as Record<string, unknown>;
  const reply = parseLlmResponse(finalData);
  if (reply.content) messages.push({ role: "assistant", content: reply.content });
  if (reply.content) {
    const stripped = reply.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (stripped) ctx.waitUntil(saveMessage(env, session.id, userId, "assistant", stripped));
  }
  ctx.waitUntil(saveSession(env, session));

  const debug = `${msgCount} msgs, tools=${usedTools}, stream=${wantStream}`;
  if (!reply.content) {
    console.error(`[gAIa] Empty LLM response (${debug})`);
    return json({ error: `Empty LLM response (${debug})` }, 502);
  }

  return json({ reply: reply.content, session_id: session.id, _debug: debug });
}

async function searchViaDataWorker(env: Env, query: string): Promise<string> {
  const resp = await env.DATA_SERVICE.fetch("https://gaia-data/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, scoreThreshold: 0.5 }),
  });

  if (!resp.ok) return "[Search error: Data Worker returned an error. Answer from your own knowledge.]";

  const { results } = await resp.json() as {
    results: Array<{ id: string; data: Record<string, unknown>; score: number }>;
  };

  if (!results?.length) return "[Search returned no results. Answer from your own knowledge or tell the user.]";

  return results
    .map((r) => `## Source: ${r.data.title ?? "Untitled"} (relevance: ${r.score.toFixed(2)})\n${r.data.canonical ?? JSON.stringify(r.data)}`)
    .join("\n\n");
}

async function searchChatHistory(env: Env, session_id: string, query: string): Promise<string> {
  const rows = await env.DB.prepare(
    "SELECT role, content, created_at FROM chat_messages WHERE session_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 20",
  ).bind(session_id, `%${query}%`).all<{ role: string; content: string; created_at: string }>();

  if (!rows.results?.length) return "";

  return rows.results
    .map((r) => `[${r.role} at ${r.created_at}]\n${r.content}`)
    .join("\n\n---\n\n");
}

async function saveMessage(env: Env, session_id: string, user_id: string, role: string, content: string, meta?: Record<string, unknown>): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO chat_messages (id, session_id, user_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), session_id, user_id, role, content.slice(0, 10000), meta ? JSON.stringify(meta) : null, new Date().toISOString()).run();
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
