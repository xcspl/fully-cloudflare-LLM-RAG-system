# TODO — gAIa

## Now

- [ ] **Auth validation**: Validate user JWT per-request (or cached with TTL). Worker calls backend `/verify { jwt, user_id }` → `{ valid: true/false }`. Cache results, deny on rejection.
- [ ] **Clear debug endpoints** from Worker before production
- [ ] **Canonicalization prompt tuning**: test different prompts for better canonical text quality

## Soon

- [ ] **Tool-based RAG**: LLM can call `search_knowledge_base` as an explicit function, with its own formulated query (see below)
- [ ] **Chat memory worker deployment**: deploy `chat-memory-worker/` and integrate with gAIa
- [ ] **Org info prompt**: project-specific system message with org details
- [ ] **Batch ingest**: script to send multiple JSON files via `ingest-data.py`

## Later

- [ ] **db_ref resolution**: implement D1 query execution for `content_type: db_ref` rows
- [ ] **url_ref resolution**: implement URL fetching for `content_type: url` rows
- [ ] **Multi-embedding support**: second `embeddings-gemini-*` column on documents
- [ ] **API tools**: earthteam backend API function calling
