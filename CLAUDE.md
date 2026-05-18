# gAIa — AI Chatbot Framework

Data-source-neutral chatbot infrastructure. A Cloudflare Worker provides AI chat with RAG using Vectorize + D1. This directory manages all config, scripts, prompts, and plans.

## Architecture (crucial)

```
Client → CF Worker (/chat) → bge-m3 (embed query) → Vectorize (search canonical vectors)
                           → D1 (resolve content, system messages, sessions)
                           → CF AI Gateway (custom-minimax) → Chat LLM (inference, stream back)
```

All LLM traffic goes through CF AI Gateway — caching, rate limiting, analytics. Never call providers directly.

## Ingestion pipeline

```
Raw doc → chunk (2k-4k tokens) → canonicalize (LLM distill) → bge-m3 (embed canonical) 
        → D1 row + Vectorize vector
```

The **canonical text** is what gets vectorized. The **resolved content** is what gets fed to the chat LLM as RAG context. They are different things.

## Content resolution (how vectors point to data)

Each D1 row has a `content_type` that tells the Worker how to resolve full content at query time:

| content_type | Field | Behavior |
|---|---|---|
| `inline` | `raw_content` | Text stored directly, use as-is |
| `db_ref` | `db_ref` (JSON) | Execute query against a D1 binding, use results |
| `url` | `url_ref` | `fetch()` the URL, use response body |

`db_ref` format: `{ "db": "gaia-db", "query": "SELECT ...", "params": [...] }` — all targets within CF infra.

## Key files

- `worker/src/index.ts` — `/chat`, `/chat/history`, `/health`
- `worker/src/rag.ts` — Vectorize search, D1 fetch, content resolution, session management
- `worker/src/llm.ts` — LLM client routing through AI Gateway (adds cf-aig-authorization header)
- `worker/src/system-messages.ts` — keyword-triggered prompt selection from D1
- `worker/src/types.ts` — shared types (Document with content_type, DbRef, etc.)
- `ingest/src/canonicalize.ts` — LLM distills raw chunks to canonical text
- `ingest/src/embed.ts` — bge-m3 embedding (to implement)
- `scripts/setup-gateway.py` — Python: creates AI Gateway + custom provider for Minimax
- `scripts/bootstrap-d1.ts` — D1 schema + seed data
- `prompts-and-system-messages/` — system prompt templates, organized by project

## Naming convention

**No provider brand names in code.** Use:
- `callLlm`, `LlmConfig` (never provider-specific names)
- `LLM_API_KEY`, `LLM_BASE_URL`, `CANON_LLM_API_KEY`, `CANON_LLM_BASE_URL`
- The ONLY brand names allowed: `embedding_model` column values. Convention: `embeddings-<model-slug>` (e.g. `embeddings-bge-m3`, future `embeddings-gemini-embedding-2`). This names the vector column that holds the actual embedding data.

## Key design decisions

- **Vector as pointer**: Vectorize entry points to D1 row; D1 row resolves to actual content (inline, DB query, or URL)
- **Two-step ingestion**: raw chunk → canonicalize (LLM) → embed (bge-m3) — never embed raw prose
- **bge-m3**: 1024d, 60k token context, $0.012/M tokens, multi-lingual
- **D1 + Vectorize**: D1 holds canonical text + resolution fields; Vectorize holds vectors + doc_id pointer
- **Prompt selection**: keyword-trigger based from `system_messages` D1 table, falls back to `default`
- **Sessions**: JSON messages array in D1, last 10 exchanges as context window
- **Streaming**: SSE pass-through from chat LLM to client

## What NOT to do

- Don't hardcode domain knowledge or project names in code
- Don't hardcode model names in LLM requests (no `model` field unless explicitly configured)
- Don't add provider-specific fields to the API call
- Don't use brand names in variable/function names or comments
- Don't log API keys or full prompts to observability
- Don't embed raw content directly — always canonicalize first
