# gAIa — AI Chatbot Framework

Two independent Workers sharing CF infra (D1, AI Gateway, bge-m3). Deployed and end-to-end tested.

## Set 1: Org Knowledge RAG (`worker/`) — DEPLOYED

```
POST /ingest → D1 store → canonicalize (custom-deep2/deepseek-v4-flash) → bge-m3 embed → Vectorize
POST /chat   → bge-m3 embed → Vectorize search → D1 fetch → LLM (custom-minimax/MiniMax-M2.7) → stream
```

- No user filtering — shared org knowledge
- Vectorize: `gaia-docs-bge-m3`, D1: `documents` table
- Deployed at: `https://gaia.sumanta-7a8.workers.dev`
- Key files: `index.ts`, `ingest.ts`, `rag.ts`, `llm.ts`, `system-messages.ts`

## Set 2: User Chat Memory (`chat-memory-worker/`) — SCAFFOLDED

- Vectorize: `gaia-chat-summaries-bge-m3`, D1: `chat_summaries` table
- User-isolated via `user_id` in metadata filter
- Not deployed yet — on hold until Set 1 is stable

## Shared infra (all deployed)

- **D1**: `gaia-db` — tables: `documents`, `chat_summaries`, `sessions`, `system_messages`
- **AI Gateway**: `et-gaia` — providers: `custom-minimax` (chat), `custom-deep2` (canonicalization)
- **Embedding**: `bge-m3` (1024d, 60k context, $0.012/M)
- **Account**: `{ACCOUNT_ID}`

## Ingestion flow

Data arrives as arbitrary JSON → D1 store (get `d1_row_id`) → extract `key_keys` → canonicalize → embed → Vectorize (with metadata pointer back to D1)

## Query flow (RAG)

User message → bge-m3 embed → Vectorize.search (matches returned, NOT data) → D1 fetch `d1_row_id` → assemble context → inject into system prompt as "Knowledge Base Results" → LLM

## Naming convention

- No provider brand names in code
- `embedding_model` column: `embeddings-<slug>` (e.g. `embeddings-bge-m3`)
- Vectorize index names: `{name}-{model}` (e.g. `gaia-docs-bge-m3`)
- Vectorize metadata keys: `canonical_text`, `d1_db_id`, `d1_row_id`, `external_url`, `user_id` (chat only), `embedding_model`

## Key gotchas

- `VECTORIZE.query()` returns `{ matches, count }`, NOT `{ data }`
- `env.AI.run()` returns nested `{ data: [[...]] }` — always `Array.from(data[0])`
- Vectorize metadata values must be strings — omit null keys
- `ExecutionContext` is runtime-injected, not constructable
- `wrangler d1 execute` needs `--remote` for production, `unset CF_API_TOKEN` if using OAuth
- AI Gateway auth header is `cf-aig-authorization`, not `Authorization`

## What NOT to do

- Don't hardcode domain knowledge or project names in code
- Don't embed raw content directly — always canonicalize first
- Don't use brand names in variable/function names or comments
- Don't log API keys or full prompts to observability
