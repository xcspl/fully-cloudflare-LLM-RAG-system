// gaia-data — Data Worker: ingestion, search, CRUD, sync, D1 + Vectorize operations.

interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  CANON_PROVIDER: string;
  CANON_MODEL: string;
  ADMIN_TOKEN: string;
  JWT_SECRET: string;
}

const EMBEDDING_MODEL = "embeddings-bge-m3";
const EMBEDDING_MODEL_ID = "@cf/baai/bge-m3";
const D1_DB_NAME = "gaia-db";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // /ingest, /search, /health — open or ADMIN_TOKEN
    if (path === "/ingest" && method === "POST") return handleIngest(request, env);
    if (path === "/search" && method === "POST") return handleSearch(request, env);
    if (path === "/health" && method === "GET") return healthCheck(env);

    // /delete (legacy, ADMIN_TOKEN)
    if (path === "/delete" && method === "POST") return handleDelete(request, env);

    // JWT-protected endpoints
    const jwt = await verifyAuth(request, env);
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    // /sync, /sync/status
    if (path === "/sync" && method === "POST") return handleSync(env);
    if (path === "/sync/status" && method === "GET") return syncStatus(env);

    // /documents collection
    if (path === "/documents" && method === "GET") return listDocuments(request, env);
    if (path === "/documents" && method === "POST") return createDocument(request, env);

    // /documents/bulk
    if (path === "/documents/bulk" && method === "POST") return bulkImport(request, env);

    // /documents/:id
    const docMatch = path.match(/^\/documents\/(.+)$/);
    if (docMatch) {
      const id = docMatch[1];
      if (method === "GET") return getDocument(id, env);
      if (method === "PUT") return updateDocument(id, request, env);
      if (method === "DELETE") return deleteDocument(id, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── JWT Auth ──

function base64url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const [header, body] = token.split(".");
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigPart = token.split(".").slice(2).join(".");
    const valid = await crypto.subtle.verify("HMAC", key, base64urlDecode(sigPart), enc.encode(`${header}.${body}`));
    if (!valid) return null;
    const dec = new TextDecoder();
    const payload = JSON.parse(dec.decode(base64urlDecode(body)));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyAuth(request: Request, env: Env): Promise<Record<string, unknown> | null> {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !env.JWT_SECRET) return null;
  return verifyJWT(token, env.JWT_SECRET);
}

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
    const id = body.slug || body.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const initial = { ...body.data, canonical: "", _key_keys: body.key_keys };
    await env.DB.prepare(
      "INSERT OR REPLACE INTO documents (id, source, data, embedding_model, vectorized, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    ).bind(id, body.source, JSON.stringify(initial), null, now).run();

    const canonicalText = await canonicalizeAndEmbed(id, env);

    return json({ id, canonical_text: canonicalText }, 201);
  } catch (e) { return json({ error: `Ingestion failed: ${e}` }, 500); }
}

// ── Core: canonicalize → embed → vectorize → update D1 ──

async function canonicalizeAndEmbed(id: string, env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT data, source FROM documents WHERE id = ?")
    .bind(id).first<{ data: string; source: string }>();
  if (!row) throw new Error("Document not found");

  const doc = JSON.parse(row.data);
  const keyKeys: string[] = doc._key_keys ?? Object.keys(doc).filter((k: string) => k !== "canonical" && k !== "_key_keys");

  const keyValues = keyKeys
    .map((k) => `${k}: ${JSON.stringify(doc[k]) ?? "N/A"}`).join("\n");

  // Canonicalize
  const canonResp = await fetch(`${env.LLM_BASE_URL}/${env.CANON_PROVIDER}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}` },
    body: JSON.stringify({ model: env.CANON_MODEL, messages: [{ role: "system", content: CANONICALIZE_PROMPT }, { role: "user", content: keyValues }], stream: false }),
  });
  if (!canonResp.ok) throw new Error(`Canonicalization failed: ${await canonResp.text()}`);
  const canonData = await canonResp.json() as { choices: [{ message: { content: string } }] };
  const canonicalText = canonData.choices[0].message.content.trim();

  // Embed
  const aiResult = await env.AI.run(EMBEDDING_MODEL_ID, { text: canonicalText });
  const vector = Array.from((aiResult as { data: number[][] }).data[0]);

  // Vectorize upsert
  const meta: Record<string, string> = { canonical_text: canonicalText, d1_db_id: D1_DB_NAME, d1_row_id: id, embedding_model: EMBEDDING_MODEL };
  await env.VECTORIZE.upsert([{ id, values: vector, metadata: meta }]);

  // Update D1
  const updated = { ...doc, canonical: canonicalText };
  await env.DB.prepare("UPDATE documents SET data = ?, embedding_model = ?, vectorized = 1 WHERE id = ?")
    .bind(JSON.stringify(updated), EMBEDDING_MODEL, id).run();

  return canonicalText;
}

// ── /search ──

async function handleSearch(request: Request, env: Env): Promise<Response> {
  let body: { query: string; topK?: number; scoreThreshold?: number; tune?: string; count?: number };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.query) return json({ error: "query required" }, 400);

  try {
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

    const ftsResults = await env.DB.prepare(
      "SELECT rowid, rank FROM documents_fts WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?",
    ).bind(body.query, topK * 2).all<{ rowid: number; rank: number }>();

    const aiResult = await env.AI.run(EMBEDDING_MODEL_ID, { text: body.query });
    const vector = Array.from((aiResult as { data: number[][] }).data[0]);
    const { matches } = await env.VECTORIZE.query(vector, { topK: topK * 2, returnMetadata: "all" });
    const vecMatches = (matches as Array<{ score: number; metadata?: { d1_row_id: string } }>) ?? [];

    const rrfScores = new Map<string, number>();
    for (let i = 0; i < (ftsResults.results?.length ?? 0); i++) {
      const docId = String(ftsResults.results![i].rowid);
      rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (RRF_K + i + 1));
    }
    for (let i = 0; i < vecMatches.length; i++) {
      const docId = vecMatches[i].metadata?.d1_row_id;
      if (docId) rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (RRF_K + i + 1));
    }

    const ranked = [...rrfScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([, score]) => score >= threshold * 0.016)
      .slice(0, resultCount);

    if (!ranked.length) return json({ results: [] });

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

// ── /delete (legacy, ADMIN_TOKEN) ──

async function handleDelete(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN || ""}` || !env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { ids: string[] };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.ids?.length) return json({ error: "ids[] required" }, 400);

  try {
    const placeholders = body.ids.map(() => "?").join(",");
    const { meta } = await env.DB.prepare(
      `DELETE FROM documents WHERE id IN (${placeholders})`,
    ).bind(...body.ids).run();

    await env.VECTORIZE.deleteByIds(body.ids);

    return json({ deleted: meta.changes ?? body.ids.length });
  } catch (e) {
    return json({ error: `Delete failed: ${e}` }, 500);
  }
}

// ── GET /documents ──

async function listDocuments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const { results } = await env.DB.prepare(
      "SELECT id, source, doc_type, embedding_model, vectorized, created_at FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?",
    ).bind(limit, offset).all<{
      id: string; source: string; doc_type: string; embedding_model: string | null; vectorized: number; created_at: string;
    }>();

    const countRow = await env.DB.prepare("SELECT COUNT(*) as total FROM documents").first<{ total: number }>();

    return json({
      documents: (results ?? []).map((r) => ({ ...r, vectorized: r.vectorized === 1 })),
      total: countRow?.total ?? 0,
      limit,
      offset,
    });
  } catch (e) {
    return json({ error: `List failed: ${e}` }, 500);
  }
}

// ── GET /documents/:id ──

async function getDocument(id: string, env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      "SELECT id, source, doc_type, data, embedding_model, vectorized, created_at FROM documents WHERE id = ?",
    ).bind(id).first<{ id: string; source: string; doc_type: string; data: string; embedding_model: string | null; vectorized: number; created_at: string }>();

    if (!row) return json({ error: "Not found" }, 404);

    return json({
      ...row,
      data: JSON.parse(row.data),
      vectorized: row.vectorized === 1,
    });
  } catch (e) {
    return json({ error: `Get failed: ${e}` }, 500);
  }
}

// ── POST /documents ──

async function createDocument(request: Request, env: Env): Promise<Response> {
  let body: { source: string; doc_type?: string; data: Record<string, unknown>; key_keys: string[] };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.data || !body.key_keys?.length || !body.source) {
    return json({ error: "data, key_keys, and source required" }, 400);
  }

  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const docType = body.doc_type || "general";

    const initial = { ...body.data, canonical: "", _key_keys: body.key_keys };
    await env.DB.prepare(
      "INSERT INTO documents (id, source, doc_type, data, embedding_model, vectorized, created_at) VALUES (?, ?, ?, ?, NULL, 0, ?)",
    ).bind(id, body.source, docType, JSON.stringify(initial), now).run();

    return json({ id, vectorized: false }, 201);
  } catch (e) {
    return json({ error: `Create failed: ${e}` }, 500);
  }
}

// ── POST /documents/bulk ──

async function bulkImport(request: Request, env: Env): Promise<Response> {
  let body: { source: string; doc_type?: string; data: Record<string, unknown>; key_keys: string[] }[];
  try {
    body = await request.json();
    if (!Array.isArray(body)) return json({ error: "Expected JSON array" }, 400);
  } catch { return json({ error: "Invalid JSON" }, 400); }

  const now = new Date().toISOString();
  const inserted: string[] = [];

  try {
    const stmt = env.DB.prepare(
      "INSERT INTO documents (id, source, doc_type, data, embedding_model, vectorized, created_at) VALUES (?, ?, ?, ?, NULL, 0, ?)",
    );

    const batch: D1PreparedStatement[] = [];
    for (const item of body) {
      if (!item.data || !item.source || !item.key_keys?.length) continue;
      const id = crypto.randomUUID();
      const initial = { ...item.data, canonical: "", _key_keys: item.key_keys };
      batch.push(stmt.bind(id, item.source, item.doc_type || "general", JSON.stringify(initial), now));
      inserted.push(id);
    }

    if (batch.length === 0) return json({ error: "No valid items" }, 400);

    await env.DB.batch(batch);
    return json({ inserted: inserted.length, ids: inserted }, 201);
  } catch (e) {
    return json({ error: `Bulk import failed: ${e}` }, 500);
  }
}

// ── PUT /documents/:id ──

async function updateDocument(id: string, request: Request, env: Env): Promise<Response> {
  let body: { source?: string; doc_type?: string; data?: Record<string, unknown>; key_keys?: string[] };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  try {
    const existing = await env.DB.prepare("SELECT data FROM documents WHERE id = ?")
      .bind(id).first<{ data: string }>();
    if (!existing) return json({ error: "Not found" }, 404);

    const current = JSON.parse(existing.data);
    const updated = { ...current, ...body.data, canonical: "", _key_keys: body.key_keys || current._key_keys || [] };

    const parts: string[] = [];
    const binds: unknown[] = [];

    if (body.source !== undefined) { parts.push("source = ?"); binds.push(body.source); }
    if (body.doc_type !== undefined) { parts.push("doc_type = ?"); binds.push(body.doc_type); }
    parts.push("data = ?"); binds.push(JSON.stringify(updated));
    parts.push("embedding_model = NULL");
    parts.push("vectorized = 0");
    binds.push(id);

    await env.DB.prepare(`UPDATE documents SET ${parts.join(", ")} WHERE id = ?`)
      .bind(...binds).run();

    return json({ id, vectorized: false });
  } catch (e) {
    return json({ error: `Update failed: ${e}` }, 500);
  }
}

// ── DELETE /documents/:id ──

async function deleteDocument(id: string, env: Env): Promise<Response> {
  try {
    const { meta } = await env.DB.prepare("DELETE FROM documents WHERE id = ?")
      .bind(id).run();

    if (meta.changes === 0) return json({ error: "Not found" }, 404);

    await env.VECTORIZE.deleteByIds([id]);

    return json({ deleted: id });
  } catch (e) {
    return json({ error: `Delete failed: ${e}` }, 500);
  }
}

// ── POST /sync ──

async function handleSync(env: Env): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id FROM documents WHERE vectorized = 0",
    ).all<{ id: string }>();

    const ids = (results ?? []).map((r) => r.id);
    const synced: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      try {
        await canonicalizeAndEmbed(id, env);
        synced.push(id);
      } catch (e) {
        failed.push(`${id}: ${e}`);
      }
    }

    return json({ synced: synced.length, failed, total: ids.length });
  } catch (e) {
    return json({ error: `Sync failed: ${e}` }, 500);
  }
}

// ── GET /sync/status ──

async function syncStatus(env: Env): Promise<Response> {
  try {
    const total = await env.DB.prepare("SELECT COUNT(*) as c FROM documents").first<{ c: number }>();
    const synced = await env.DB.prepare("SELECT COUNT(*) as c FROM documents WHERE vectorized = 1").first<{ c: number }>();
    return json({
      total: total?.c ?? 0,
      synced: synced?.c ?? 0,
      pending: (total?.c ?? 0) - (synced?.c ?? 0),
    });
  } catch (e) {
    return json({ error: `Status failed: ${e}` }, 500);
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
