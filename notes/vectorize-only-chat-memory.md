# Vectorize-Only Chat Memory

Idea: drop D1 from chat-memory-worker. Store everything in Vectorize metadata.

## Why it works

- Chat summaries are short (~200-500 chars) — well within 10 KiB metadata limit
- No need for structured queries on chat summaries (just RAG search)
- Simpler: one less dependency, no D1 round-trip at search time
- Easier chunking: split long conversations into multiple summary entries, each self-contained

## Schema (Vectorize-only)

```
Vectorize entry:
  values: [1024 floats]
  metadata: {
    canonical_text: "Summary of conversation chunk...",
    user_id: "user-123",
    msg_count: 14,
    chat_ids: ["chat-uuid-1", "chat-uuid-2"],
    created_at: "2026-05-19T..."
    embedding_model: "embeddings-bge-m3"
  }
```

## Query flow

1. Embed user query → Vectorize.search
2. Filter results by user_id from metadata
3. Return canonical_text directly — the metadata IS the result

Zero D1 involvement. If audit trail needed later, add D1 as a write-only log (not read path).

Status: concept, not implemented.
