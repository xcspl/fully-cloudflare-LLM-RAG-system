# TODO — gAIa

## Done (Chapter 1)

- [x] **Polish**: EarthTeam identity injection, GMT time, session hygiene, UI polish
- [x] **Tool-based RAG**: Fixed Minimax format (preserve full ToolCall, role=tool + tool_call_id)
- [x] **Score threshold**: 0.5 minimum for vector matches
- [x] **Dedup slugs**: MD5(source + entire data JSON) for idempotent re-ingestion
- [x] **Production domains**: gaia-api.earth-team.org, gaia-chat.earth-team.org
- [x] **EarthTeam data**: 9 entries ingested
- [x] **Freeland data**: 8 entries ingested
- [x] **Earth Credits guide**: 7 entries ingested
- [x] **3 tools**: search_knowledge_base, get_current_time, search_chat_history
- [x] **Session history migration**: chat_messages table (one row per item), 50-item context, compact markers, think-stripped saves

## Soon

- [ ] **User profile table**: Compacted summary of user's chat history — key topics, preferences, frequently discussed subjects. Trigger: when user starts a new session (no existing session_id for that user), Worker background-compacts last session + previous profile → new profile. Injected into system prompt automatically on next request. Gives LLM instant awareness of who it's talking to.
- [ ] **Auth validation**: Frontend sends JWT + username → Worker caches 5 min TTL → POST /verify to backend. Cache hit = proceed. Cache miss/deny = blacklist.

- [ ] **Auth validation**: Frontend sends JWT + username → Worker caches 5 min TTL → POST /verify to backend. Cache hit = proceed. Cache miss/deny = blacklist.
- [ ] **search_chat_history cross-session**: LLM sets `search_all_sessions: true` → Worker searches ALL sessions for that user_id, not just current session
- [ ] **Chat log cleaner**: Cron worker/script to truncate chat_messages rows for sessions with >500 items; delete sessions older than 6 months
- [ ] **Deterministic filters on RAG**: Filter by `source`, `category`, `section` etc. alongside vector search
- [ ] **Chat memory worker**: Deploy `chat-memory-worker/` for vectorize-only user chat summaries
- [ ] **Non-CoT LLM provider**: Add a non-reasoning model for faster tool checks

## Later

- [ ] **Web search tool**: Uncomment `WEB_SEARCH` in tools.ts and implement handler (needs API subscription)
- [ ] **Tool-based RAG with streaming**: Solve Minimax streaming + tools limitation
- [x] **Hybrid search**: D1 FTS5 + Vectorize merged via Reciprocal Rank Fusion
- [ ] **Multi-embedding support**: Second `embeddings-*` column on documents
- [ ] **db_ref resolution**: Execute D1 queries for linked data entries
- [ ] **url_ref resolution**: Fetch external URLs at query time
- [ ] **API tools**: EarthTeam backend API function calling
