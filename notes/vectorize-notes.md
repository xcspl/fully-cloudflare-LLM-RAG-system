# Vectorize Notes

## Current index

- **Name**: `gaia-docs`
- **Dimensions**: 1024
- **Metric**: cosine
- **Embedding model**: `@cf/baai/bge-m3` (via CF Workers AI)
- **Column convention**: Vector columns are named `embeddings-<model-slug>`. Current: `embeddings-bge-m3`. Future models would add columns like `embeddings-gemini-embedding-2`.
- **Context window**: 60,000 tokens per request
- **Pricing**: $0.012 per million input tokens
- **Languages**: Multi-lingual (100+ languages)

## Quotas (Free tier)

- Indexes: 1
- Vectors per index: 200,000
- Dimensions: up to 1536
- Query operations: included with Workers Paid plan

## Pricing (Paid)

- Per 100k vectors: check current CF pricing page
- Query operations: no separate charge

## Switching embedding models

1. Update the dimension in Vectorize index config
2. Update the embedding model name in `ingest/src/embed.ts`
3. Re-ingest all documents (different dimensions = incompatible vectors)
4. The `embedding_model` column in Vectorize metadata and D1 tracks which model generated each vector (always `embeddings-<model>` format)

## bge-m3 specific notes

- Input: accepts raw text up to 60k tokens per request
- Output: 1024-dimensional float vector
- Default pooling: mean (configurable to cls)
- Multi-granularity: can produce sparse + dense embeddings at multiple levels
- Batch: supports array of inputs in a single request
