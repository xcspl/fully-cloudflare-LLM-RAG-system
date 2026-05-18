# LLM Provider Notes

Keep provider-specific notes here — rate limits, pricing, model IDs, quirks.

## Current provider

- **Type**: OpenAI-compatible API
- **Base URL**: Configured via `LLM_BASE_URL`
- **Auth**: Bearer token via `LLM_API_KEY`

## Adding a new provider

The `llm.ts` module is provider-agnostic — it sends standard `/chat/completions` requests. To switch providers:

1. Update `LLM_BASE_URL` in `.env` and `wrangler.toml`
2. Update `LLM_API_KEY` via `wrangler secret put`
3. If the provider needs extra fields (e.g., `model`), add them in `llm.ts`

The Worker code itself should remain generic.
