# Phase 1: Static Document Ingestion

Status: planned

## Goal

Seed the Vectorize + D1 knowledge base with static documents. After this phase, `/chat` returns RAG-augmented responses.

## Steps

1. Place documents in `ingest/data/`
2. Run the ingest pipeline: chunk → embed → upload
3. Verify via `/chat` that documents appear in the context

## Ingest script stub

The script at `ingest/src/index.ts` will:
1. Walk `ingest/data/` for supported files
2. Split each into ~500-token chunks with ~50-token overlap
3. Call the embedding API for each chunk
4. Insert content + metadata into D1 `documents`
5. Insert vectors into Vectorize `gaia-docs` with `doc_id` reference

## First ingest checklist

- [ ] Embedding API endpoint confirmed and reachable
- [ ] D1 table `documents` created
- [ ] Vectorize index `gaia-docs` created
- [ ] Sample documents placed in `ingest/data/`
- [ ] Ingest script run successfully
- [ ] Manual `/chat` test confirms document in context
