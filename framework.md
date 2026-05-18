# gAIa — AI Chatbot Framework

Data-source-neutral chatbot infrastructure. Ingests documents → serves RAG-augmented chat via Cloudflare Workers.

## Components

| Component | Location | Status | Description |
|-----------|----------|--------|-------------|
| CF Worker | `worker/` | ⬚ pending | gAIa chatbot — handles /chat, RAG, LLM proxy |
| D1 Database | `worker/wrangler.toml` | ⬚ pending | Structured data: system messages, doc metadata, sessions |
| Vectorize Index | `worker/wrangler.toml` | ⬚ pending | Vector store for RAG, 1024d cosine (bge-m3) |
| AI Gateway | `scripts/setup-gateway.py` | ⬚ pending | Single entry point for all LLM calls. Custom provider: minimax |
| Chat LLM | via AI Gateway | ✅ creds available | Minimax via custom-minimax on gateway |
| Canonicalization LLM | `ingest/src/canonicalize.ts` | ⬚ pending | Distills raw chunks to canonical text |
| Embedding Model | CF Workers AI bge-m3 | ⬚ pending | 1024d, 60k context, $0.012/M, multi-lingual |
| Ingestion Pipeline | `ingest/` | ⬚ pending | Chunk → canonicalize → embed → upload |
| Prompt Templates | `prompts-and-system-messages/` | ⬚ pending | System messages, organized by project |
| Bootstrap Script | `scripts/bootstrap-d1.ts` | ⬚ pending | Create D1 tables, seed system messages |
| Health Check | `scripts/health-check.ts` | ⬚ pending | Verify all components are live |

## Content Resolution Strategy

A vector in Vectorize is a **pointer** — it doesn't contain the full content, it tells the Worker where to get it. Three resolution strategies:

| content_type | Field | Behavior | Example |
|---|---|---|---|
| `inline` | `raw_content` | Content stored directly | Static docs, policies, guides |
| `db_ref` | `db_ref` (JSON) | Execute query against D1 binding | Live data: posts, users, transactions |
| `url` | `url_ref` | HTTP fetch | External sources, APIs, websites |

`db_ref` format: `{ "db": "gaia-db", "query": "SELECT content FROM posts WHERE id = ?", "params": ["abc123"] }`

All `db_ref` targets are within CF infra (D1 bindings the Worker has access to). URLs can point anywhere.

## Connections

```
Ingestion:
  Raw file/URL → Chunker → Canonicalize LLM → Canonical text
                                              │
  Canonical text → bge-m3 embed → Vectorize (vector + doc_id pointer)
  Resolution info (content_type, raw_content/db_ref/url_ref) → D1

Query:
  User message → bge-m3 embed → Vectorize (search canonical vectors, get doc_ids)
  doc_ids → D1 (fetch rows, resolve content by content_type)
  Resolved content + System message + Session history → AI Gateway → Chat LLM → Stream back
```

## Environment Variables

See `.env.example`. Core vars:
- `CF_ACCOUNT_ID` / `CF_API_TOKEN` — Cloudflare account + API
- `CF_AI_GATEWAY_ID` / `CF_AI_GATEWAY_TOKEN` — AI Gateway (created by setup-gateway.py)
- `LLM_API_KEY` / `LLM_BASE_URL` — Chat LLM (base_url = gateway URL)
- `CANON_LLM_API_KEY` / `CANON_LLM_BASE_URL` — Canonicalization LLM

## Quick Start

1. `cp .env.example .env` and fill in values
2. `cd worker && npm install && npx wrangler d1 create gaia-db`
3. Update `worker/wrangler.toml` with the D1 database_id
4. `npx wrangler secret put LLM_API_KEY`
5. `npx wrangler deploy`
6. Place documents in `ingest/data/` and run the ingest pipeline

## Current State

- [ ] Worker deployed
- [ ] D1 tables created
- [ ] Vectorize index created
- [ ] First documents ingested
- [ ] Chat endpoint working end-to-end
- [ ] Client integration tested
