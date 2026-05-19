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

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env, ctx);
    }

    if (url.pathname === "/chat/history" && request.method === "GET") {
      return handleHistory(request, env);
    }

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return healthCheck(env);
    }

    return new Response("Not found", { status: 404 });
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>gAIa Chat v3</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:14px/1.5 system-ui,sans-serif;background:#0f0f0f;color:#e0e0e0;height:100vh;display:flex;flex-direction:column}
#log{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.75rem}
.msg{max-width:80%;padding:.6rem 1rem;border-radius:1rem;white-space:pre-wrap;word-break:break-word}
.msg.user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:.25rem}
.msg.assistant{align-self:flex-start;background:#1e1e1e;border:1px solid #333;border-bottom-left-radius:.25rem}
.msg.assistant em{color:#93c5fd}.msg.assistant strong{color:#fbbf24}.msg.assistant code{background:#333;padding:.1em .3em;border-radius:3px;font-size:13px}
.think{display:block;font-size:12px;color:#666;cursor:pointer;margin:.3em 0;padding:.3em .5em;border-left:2px solid #444;background:#111;border-radius:0 4px 4px 0}.think:hover{color:#999}.think.open{color:#aaa}.think .body{display:none;margin-top:.3em;color:#999}.think.open .body{display:block}
.spin{display:inline-block;width:8px;height:8px;border-radius:50%;background:#888;animation:b .6s infinite alternate}
.spin:nth-child(2){animation-delay:.2s}.spin:nth-child(3){animation-delay:.4s}
@keyframes b{to{background:#fff;transform:translateY(-6px)}}
#form{display:flex;padding:.75rem;gap:.5rem;border-top:1px solid #222;background:#0a0a0a}
#form input{flex:1;padding:.6rem 1rem;border:1px solid #333;border-radius:1.5rem;background:#1a1a1a;color:#e0e0e0;font-size:14px;outline:none}
#form input:focus{border-color:#3b82f6}
#form button{padding:.6rem 1.25rem;border:none;border-radius:1.5rem;background:#2563eb;color:#fff;font-size:14px;cursor:pointer}
#form button:hover{background:#1d4ed8}
</style></head>
<body>
<div id="log"></div>
<form id="form"><input id="input" placeholder="Ask gAIa..." autofocus><button>Send</button></form>
<script>
const log=document.getElementById("log"),form=document.getElementById("form"),inp=document.getElementById("input");
let sid="";
form.onsubmit=async e=>{e.preventDefault();const m=inp.value.trim();if(!m)return;inp.value="";add("user",m);const div=add("assistant","");
try{const r=await fetch("/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:m,user_id:"web-"+Math.random().toString(36).slice(2,8),session_id:sid||void 0})});
sid=r.headers.get("X-Session-Id")||sid;
if(r.headers.get("Content-Type")?.includes("text/event-stream")){div.innerHTML="";const rb=r.body.getReader(),td=new TextDecoder();let buf="",last=Date.now();
while(true){const{value,done}=await rb.read();if(done)break;last=Date.now();
buf+=td.decode(value,{stream:true});
const lines=buf.split("\\n");buf=lines.pop()||"";
for(const l of lines){if(!l.startsWith("data: "))continue;try{const j=JSON.parse(l.slice(6));const c=j.choices?.[0]?.delta?.content;if(c)div.innerHTML+=c.replace(/</g,"&lt;")}catch{}}}}
if(!div.innerHTML.trim())div.innerHTML="<em>(empty)</em>"}else{const d=await r.json();div.innerHTML=d.reply?d.reply.replace(/</g,"&lt;"):"<em>(no response)</em>"}
div.innerHTML=div.innerHTML.replace(/<\\/think>/g,"").replace(/<think>[\\s\\S]*?<\\/think>/g,"");
div.innerHTML=div.innerHTML.replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>").replace(/\\*(.+?)\\*/g,"<em>$1</em>").replace(/\\n/g,"<br>")}
catch(x){div.innerHTML="<em>Error: "+x.message+"</em>"}
scroll()};
function add(role,text){const d=document.createElement("div");d.className="msg "+role;d.innerHTML=role==="assistant"?"<span class=spin></span><span class=spin></span><span class=spin></span>":text.replace(/</g,"&lt;");log.appendChild(d);return d}
function scroll(){log.scrollTop=log.scrollHeight}
</script></body></html>`;

