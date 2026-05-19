import type { DocumentData, VectorizeMetadata, ChatMessage } from "./types";
import { callLlm } from "./llm";

export interface IngestEnv {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CF_AIG_TOKEN: string;
  LLM_BASE_URL: string;
  CANON_PROVIDER: string;     // "custom-deep2"
  CANON_MODEL: string;        // "deepseek-v4-flash"
}

export interface IngestRequest {
  data: Record<string, unknown>;
  key_keys: string[];
  source: string;
  external_url?: string | null;
}

const EMBEDDING_MODEL = "embeddings-bge-m3";
const EMBEDDING_MODEL_ID = "@cf/baai/bge-m3";
const D1_DB_NAME = "gaia-db";

const CANONICALIZE_PROMPT = `Given selected key fields from a document, produce a concise canonical text that captures all factual information. Preserve names, numbers, dates, and specific details. Use a neutral, consistent tone. Output only the canonical text, no preamble.

Key fields:
`;

export async function handleIngest(
  request: Request,
  env: IngestEnv,
): Promise<Response> {
  let body: IngestRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.data || !body.key_keys?.length || !body.source) {
    return json({ error: "data, key_keys, and source are required" }, 400);
  }

  try {
    // 1. Store raw JSON in D1, get row ID
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const initialData: DocumentData = {
      ...body.data,
      canonical: "",
      content_type: "inline",
      chunk_index: 0,
    };

    await env.DB.prepare(
      `INSERT INTO documents (id, source, data, embedding_model, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, body.source, JSON.stringify(initialData), null, now)
      .run();

    // 2. Extract key fields for canonicalization
    const keyValues = body.key_keys
      .map((k) => `${k}: ${JSON.stringify(body.data[k]) ?? "N/A"}`)
      .join("\n");

    // 3. Canonicalize via gateway (custom-deep2 / deepseek-v4-flash)
    const messages: ChatMessage[] = [
      { role: "system", content: CANONICALIZE_PROMPT },
      { role: "user", content: keyValues },
    ];

    const canonResp = await callLlm(
      {
        gatewayToken: env.CF_AIG_TOKEN,
        baseUrl: env.LLM_BASE_URL,
        providerSlug: env.CANON_PROVIDER,
        model: env.CANON_MODEL,
        apiMode: "openai",
      },
      messages,
      false, // no streaming for canonicalization
    );

    if (!canonResp.ok) {
      throw new Error(`Canonicalization failed: ${await canonResp.text()}`);
    }

    const canonData = (await canonResp.json()) as {
      choices: [{ message: { content: string } }];
    };
    const canonicalText = canonData.choices[0].message.content.trim();

    // 4. Embed canonical text via bge-m3
    const vector = await embedText(env, canonicalText);

    // 5. Insert into Vectorize
    const metadata: VectorizeMetadata = {
      canonical_text: canonicalText,
      d1_db_id: D1_DB_NAME,
      d1_row_id: id,
      external_url: body.external_url ?? null,
      embedding_model: EMBEDDING_MODEL,
    };

    // Filter out null/undefined values (Vectorize requires string values)
    const clean = Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => v != null),
    ) as Record<string, string>;

    await env.VECTORIZE.upsert([
      { id, values: vector, metadata: clean },
    ]);

    // 6. Update D1 row with canonical text and embedding model
    const finalData: DocumentData = {
      ...initialData,
      canonical: canonicalText,
    };

    await env.DB.prepare(
      `UPDATE documents SET data = ?, embedding_model = ? WHERE id = ?`,
    )
      .bind(JSON.stringify(finalData), EMBEDDING_MODEL, id)
      .run();

    return json({ id, canonical_text: canonicalText }, 201);
  } catch (e) {
    return json({ error: `Ingestion failed: ${e}` }, 500);
  }
}

async function embedText(env: IngestEnv, text: string): Promise<number[]> {
  const result = await env.AI.run(EMBEDDING_MODEL_ID, { text });
  const raw = result as { data: unknown };
  const inner = (raw.data as unknown[][])[0];
  return Array.from(inner as Iterable<number>);
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
