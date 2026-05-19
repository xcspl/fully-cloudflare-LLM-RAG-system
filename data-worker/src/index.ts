// gaia-data — Data Worker: ingestion, search, embedding, D1 + Vectorize operations.

interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  CANON_PROVIDER: string;
  CANON_MODEL: string;
}

const EMBEDDING_MODEL = "embeddings-bge-m3";
const EMBEDDING_MODEL_ID = "@cf/baai/bge-m3";
const D1_DB_NAME = "gaia-db";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ingest" && request.method === "POST") return handleIngest(request, env);
    if (url.pathname === "/search" && request.method === "POST") return handleSearch(request, env);
    if (url.pathname === "/health" && request.method === "GET") return healthCheck(env);
    return new Response("Not found", { status: 404 });
  },
};

// ── /ingest ──

const CANONICALIZE_PROMPT = `Given selected key fields from a document, produce a concise canonical text that captures all factual information. Preserve names, numbers, dates, and specific details. Use a neutral, consistent tone. Output only the canonical text, no preamble.

Key fields:
`;

async function handleIngest(request: Request, env: Env): Promise<Response> {
  let body: { data: Record<string, unknown>; key_keys: string[]; source: string; external_url?: string | null };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.data || !body.key_keys?.length || !body.source) {
    return json({ error: "data, key_keys, and source required" }, 400);
  }

  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // 1. D1 store
    const initial = { ...body.data, canonical: "" };
    await env.DB.prepare(
      "INSERT INTO documents (id, source, data, embedding_model, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, body.source, JSON.stringify(initial), null, now).run();

    // 2. Extract key keys
    const keyValues = body.key_keys
      .map((k) => `${k}: ${JSON.stringify(body.data[k]) ?? "N/A"}`).join("\n");

    // 3. Canonicalize
    const canonResp = await fetch(`${env.LLM_BASE_URL}/${env.CANON_PROVIDER}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}` },
      body: JSON.stringify({ model: env.CANON_MODEL, messages: [{ role: "system", content: CANONICALIZE_PROMPT }, { role: "user", content: keyValues }], stream: false }),
    });
    if (!canonResp.ok) throw new Error(`Canonicalization failed: ${await canonResp.text()}`);
    const canonData = await canonResp.json() as { choices: [{ message: { content: string } }] };
    const canonicalText = canonData.choices[0].message.content.trim();

    // 4. Embed
    const aiResult = await env.AI.run(EMBEDDING_MODEL_ID, { text: canonicalText });
    const vector = Array.from(((aiResult as { data: unknown[][] }).data)[0]);

    // 5. Vectorize
    const meta: Record<string, string> = { canonical_text: canonicalText, d1_db_id: D1_DB_NAME, d1_row_id: id, embedding_model: EMBEDDING_MODEL };
    if (body.external_url) meta.external_url = body.external_url;
    await env.VECTORIZE.upsert([{ id, values: vector, metadata: meta }]);

    // 6. Update D1
    await env.DB.prepare("UPDATE documents SET data = ?, embedding_model = ? WHERE id = ?")
      .bind(JSON.stringify({ ...initial, canonical: canonicalText }), EMBEDDING_MODEL, id).run();

    return json({ id, canonical_text: canonicalText }, 201);
  } catch (e) { return json({ error: `Ingestion failed: ${e}` }, 500); }
}

// ── /search ──

async function handleSearch(request: Request, env: Env): Promise<Response> {
  let body: { query: string; topK?: number };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.query) return json({ error: "query required" }, 400);

  try {
    const aiResult = await env.AI.run(EMBEDDING_MODEL_ID, { text: body.query });
    const vector = Array.from(((aiResult as { data: unknown[][] }).data)[0]);
    const { matches } = await env.VECTORIZE.query(vector, { topK: body.topK ?? 5, returnMetadata: "all" });
    if (!matches?.length) return json({ results: [] });

    const ids = (matches as Array<{ metadata?: { d1_row_id: string } }>)
      .map((m) => m.metadata?.d1_row_id).filter(Boolean);
    if (!ids.length) return json({ results: [] });

    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, source, data, embedding_model FROM documents WHERE id IN (${placeholders})`,
    ).bind(...ids).all<{ id: string; source: string; data: string; embedding_model: string | null }>();

    const resolved = (results ?? []).map((row, i) => ({
      id: row.id,
      source: row.source,
      data: JSON.parse(row.data),
      embedding_model: row.embedding_model,
      score: (matches as Array<{ score: number }>)[i]?.score,
    }));
    return json({ results: resolved });
  } catch (e) { return json({ error: `Search failed: ${e}` }, 500); }
}

// ── /health ──

async function healthCheck(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};
  try { await env.DB.prepare("SELECT 1").run(); checks.d1 = "ok"; } catch (e) { checks.d1 = String(e); }
  try { const r = await env.AI.run(EMBEDDING_MODEL_ID, { text: "h" }); checks.ai = ((r as { data: unknown[] }).data?.length ?? 0) > 0 ? "ok" : "no data"; } catch (e) { checks.ai = String(e); }
  try { const r = await env.AI.run(EMBEDDING_MODEL_ID, { text: "h" }); const v = Array.from(((r as { data: unknown[][] }).data)[0]); await env.VECTORIZE.query(v, { topK: 1 }); checks.vectorize = "ok"; } catch (e) { checks.vectorize = String(e); }
  return json(checks, Object.values(checks).every((v) => v === "ok") ? 200 : 500);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
