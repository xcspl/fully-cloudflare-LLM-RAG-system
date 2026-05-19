# gAIa — AI Chatbot Framework

Two independent Workers, shared CF infra. Deployed and end-to-end tested.

## Set 1: Org Knowledge RAG — DEPLOYED

| Component | Location | Status | Description |
|-----------|----------|--------|-------------|
| Worker | `worker/` | ✅ Deployed | `https://gaia.sumanta-7a8.workers.dev` |
| D1 | `documents` table | ✅ Created | Shared knowledge — org info, app docs, projects |
| Vectorize | `gaia-docs-bge-m3` | ✅ Created | 1024d cosine, metadata → D1 pointer |
| Access | — | Open | All users see the same knowledge |

```
POST /ingest  → D1 store → canonicalize (custom-deep2/deepseek-v4-flash) → bge-m3 embed → Vectorize
POST /chat    → bge-m3 embed → Vectorize search → D1 fetch → LLM (custom-minimax/MiniMax-M2.7) → stream
```

## Set 2: User Chat Memory — SCAFFOLDED

| Component | Location | Status | Description |
|-----------|----------|--------|-------------|
| Worker | `chat-memory-worker/` | ⬚ Not deployed | On hold until Set 1 stable |
| D1 | `chat_summaries` table | ✅ Created | Per-user summaries (has `user_id`) |
| Vectorize | `gaia-chat-summaries-bge-m3` | ✅ Created | 1024d cosine, metadata includes `user_id` |

## Shared Infrastructure

| Component | Used by | Status | Details |
|-----------|---------|--------|---------|
| D1 | Both | ✅ | `gaia-db` — 4 tables created |
| AI Gateway | Both | ✅ | `et-gaia` — custom-minimax, custom-deep2 |
| bge-m3 | Both | ✅ | Via Workers AI binding |
| CF Account | Both | ✅ | `{ACCOUNT_ID}` |

## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Per-inference context, naming rules, gotchas |
| `framework.md` | This file — full map of all components |
| `todo.md` | Pending work and priorities |
| `cloudflare-findings.md` | Gotchas discovered during implementation |
| `worker/src/index.ts` | Main Worker: `/ingest`, `/chat`, `/health` |
| `worker/src/rag.ts` | Vectorize search, D1 fetch, context assembly |
| `worker/src/llm.ts` | LLM client via AI Gateway |
| `worker/src/ingest.ts` | Ingestion pipeline (D1 → canonicalize → embed → Vectorize) |
| `scripts/setup-gateway.py` | Python: create AI Gateway + custom provider |
| `scripts/ingest-data.py` | Python: send JSON files to `/ingest` |
| `scripts/bootstrap-d1.ts` | D1 schema + seed prompts |
| `data-ingest/` | JSON files for ingestion |
| `prompts-and-system-messages/` | Prompt templates (default domain + per-project) |
| `notes/` | Design notes, provider specs, setup guides |

## Environment Variables

See `.env.example`. Core vars:
- `CF_ACCOUNT_ID` / `CF_AIG_TOKEN` — Cloudflare / Gateway
- `LLM_BASE_URL` / `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_MODE` — Chat LLM
- `CANON_PROVIDER` / `CANON_MODEL` — Canonicalization LLM (independent)
- `WORKER_URL` — Deployed Worker URL (for ingest scripts)

## Quick Start

1. `cp .env.example .env` and fill in values
2. `cd worker && npm install`
3. `npx wrangler secret put CF_AIG_TOKEN`
4. `npx wrangler deploy`
5. `python scripts/ingest-data.py data-ingest/sample.json`
