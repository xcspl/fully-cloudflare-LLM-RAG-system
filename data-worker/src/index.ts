// gaia-data — Data Worker: ingestion, search, embedding, D1 + Vectorize operations.

interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  CANON_PROVIDER: string;
  CANON_MODEL: string;
  ADMIN_TOKEN: string;
}

const EMBEDDING_MODEL = "embeddings-bge-m3";
const EMBEDDING_MODEL_ID = "@cf/baai/bge-m3";
const D1_DB_NAME = "gaia-db";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ingest" && request.method === "POST") return handleIngest(request, env);
    if (url.pathname === "/search" && request.method === "POST") return handleSearch(request, env);
    if (url.pathname === "/delete" && request.method === "POST") return handleDelete(request, env);
    if (url.pathname === "/health" && request.method === "GET") return healthCheck(env);
    return new Response("Not found", { status: 404 });
  },
};

// ── /ingest ──

const CANONICALIZE_PROMPT = `Given selected key fields from a document, produce a concise canonical text that captures all factual information. Preserve names, numbers, dates, and specific details. Use a neutral, consistent tone. Output only the canonical text, no preamble.

Key fields:
`;

async function handleIngest(request: Request, env: Env): Promise<Response> {
  let body: { data: Record<string, unknown>; key_keys: string[]; source: string; external_url?: string | null; slug?: string; id?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.data || !body.key_keys?.length || !body.source) {
    return json({ error: "data, key_keys, and source required" }, 400);
  }

  try {
    // Idempotent: use provided id/slug, or generate UUID. INSERT OR REPLACE = safe to re-run.
    const id = body.slug || body.id || crypto.randomUUID();
    const now = new Date().toISOString();

    // 1. D1 store (upsert — re-running with same slug updates, not duplicates)
    const initial = { ...body.data, canonical: "" };
    await env.DB.prepare(
      "INSERT OR REPLACE INTO documents (id, source, data, embedding_model, created_at) VALUES (?, ?, ?, ?, ?)",
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
    const vector = Array.from((aiResult as { data: number[][] }).data[0]);

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
  let body: { query: string; topK?: number; scoreThreshold?: number; tune?: string; count?: number };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.query) return json({ error: "query required" }, 400);

  try {
    // Map tune to presets
    const tune = body.tune || "normal";
    const presets: Record<string, { topK: number; threshold: number; rrfK: number }> = {
      sharp: { topK: 3, threshold: 0.6, rrfK: 30 },
      normal: { topK: 5, threshold: 0.3, rrfK: 60 },
      wide: { topK: 10, threshold: 0.1, rrfK: 120 },
    };
    const preset = presets[tune] || presets.normal;
    const topK = body.topK ?? preset.topK;
    const threshold = body.scoreThreshold ?? preset.threshold;
    const RRF_K = preset.rrfK;
    const resultCount = body.count ?? 5;

    // Arm 1: FTS5 keyword search
    const ftsResults = await env.DB.prepare(
      "SELECT rowid, rank FROM documents_fts WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?",
    ).bind(body.query, topK * 2).all<{ rowid: number; rank: number }>();

    // Arm 2: Vectorize semantic search
    const aiResult = await env.AI.run(EMBEDDING_MODEL_ID, { text: body.query });
    const vector = Array.from((aiResult as { data: number[][] }).data[0]);
    const { matches } = await env.VECTORIZE.query(vector, { topK: topK * 2, returnMetadata: "all" });
    const vecMatches = (matches as Array<{ score: number; metadata?: { d1_row_id: string } }>) ?? [];

    // Reciprocal Rank Fusion
    const rrfScores = new Map<string, number>();

    for (let i = 0; i < (ftsResults.results?.length ?? 0); i++) {
      const docId = String(ftsResults.results![i].rowid);
      rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (RRF_K + i + 1));
    }
    for (let i = 0; i < vecMatches.length; i++) {
      const docId = vecMatches[i].metadata?.d1_row_id;
      if (docId) {
        rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (RRF_K + i + 1));
      }
    }

    // Sort by RRF score, filter by threshold
    const ranked = [...rrfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, score]) => score >= threshold * 0.016)
      .slice(0, resultCount);

    if (!ranked.length) return json({ results: [] });

    // Fetch from D1
    const ids = ranked.map(([id]) => id);
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, source, data, embedding_model FROM documents WHERE id IN (${placeholders})`,
    ).bind(...ids).all<{ id: string; source: string; data: string; embedding_model: string | null }>();

    const scoreMap = new Map(ranked);
    const resolved = (results ?? []).map((row) => ({
      id: row.id,
      source: row.source,
      data: JSON.parse(row.data),
      embedding_model: row.embedding_model,
      score: scoreMap.get(row.id) ?? 0,
    }));
    return json({ results: resolved });
  } catch (e) { return json({ error: `Search failed: ${e}` }, 500); }
}

// ── /delete ──

async function handleDelete(request: Request, env: Env): Promise<Response> {
  // Require shared admin token
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN || ""}` || !env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { ids: string[] };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.ids?.length) return json({ error: "ids[] required" }, 400);

  try {
    // Delete from D1
    const placeholders = body.ids.map(() => "?").join(",");
    const { meta } = await env.DB.prepare(
      `DELETE FROM documents WHERE id IN (${placeholders})`,
    ).bind(...body.ids).run();

    // Delete from Vectorize
    await env.VECTORIZE.deleteByIds(body.ids);

    return json({ deleted: meta.changes ?? body.ids.length });
  } catch (e) {
    return json({ error: `Delete failed: ${e}` }, 500);
  }
}

// ── /health ──

async function healthCheck(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};
  try { await env.DB.prepare("SELECT 1").run(); checks.d1 = "ok"; } catch (e) { checks.d1 = String(e); }
  try { const r = await env.AI.run(EMBEDDING_MODEL_ID, { text: "h" }); checks.ai = ((r as { data: unknown[] }).data?.length ?? 0) > 0 ? "ok" : "no data"; } catch (e) { checks.ai = String(e); }
  try { const r = await env.AI.run(EMBEDDING_MODEL_ID, { text: "h" }); const v = Array.from(((r as { data: number[][] }).data)[0]); await env.VECTORIZE.query(v, { topK: 1 }); checks.vectorize = "ok"; } catch (e) { checks.vectorize = String(e); }
  return json(checks, Object.values(checks).every((v) => v === "ok") ? 200 : 500);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
