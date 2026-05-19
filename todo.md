# TODO — gAIa

## Now

- [ ] **Polish**: EarthTeam identity in system prompt, GMT time, session hygiene, UI polish (plan: gAIA-v1-polish.md)
- [ ] **Score threshold**: Filter low-quality vector matches (< 0.5) — implemented in Data Worker, deploy pending

## Soon

- [ ] **Deterministic filters on RAG**: Filter by `source`, `category`, `section` etc. alongside vector search. e.g. "show only earth-team-main-site entries about initiatives"
- [ ] **Auth validation**: Validate user JWT per-request (or cached with TTL). Worker calls backend `/verify { jwt, user_id }` → `{ valid: true/false }`
- [ ] **Chat memory worker**: Deploy `chat-memory-worker/` for vectorize-only user chat summaries
- [ ] **Non-CoT LLM provider**: Add a non-reasoning model for faster tool checks (reduce 2-call latency)

## Later

- [ ] **Hybrid search**: D1 FTS5 + Vectorize merged via Reciprocal Rank Fusion
- [ ] **Multi-embedding support**: Second `embeddings-*` column on documents
- [ ] **db_ref resolution**: Execute D1 queries for linked data entries
- [ ] **url_ref resolution**: Fetch external URLs at query time
- [ ] **API tools**: EarthTeam backend API function calling
