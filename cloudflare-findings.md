# Cloudflare Findings

Gotchas and discoveries during gAIa implementation.

## Minimax M2.7 Tool Calling

- **Must preserve full tool_call structure**: `{ id, index, type, function: { name, arguments } }`. Dropping `index` or flattening `function` causes `choices: null`.
- **Tool result role**: `role: "tool"` WITH `tool_call_id` works. Without `tool_call_id`, Minimax returns `choices: null`. `role: "user"` as tool result returns error 2013.
- **No `tool_choice`**: Do NOT send `tool_choice: "auto"` — Minimax doesn't need it and may reject.
- **Final call without tools**: After tool loop, call WITHOUT tools. Minimax accepts tool messages in history if no tools in current request.
- **Streaming limitation**: Cannot stream when tool messages are in history (Minimax 520). Use non-streaming JSON for tool-based responses.

## AI Gateway

- **Custom providers**: Slug must not include path segments (e.g., `base_url: "https://api.minimax.io"`, path goes in the request URL). Including `/v1` in base_url causes duplicate path segments.
- **Auth header**: Gateway requests use `cf-aig-authorization: Bearer <token>`, NOT `Authorization`. The provider's API key is stored in the gateway config; clients only need the gateway token.
- **URL pattern**: Provider-specific: `/custom-{slug}/v1/chat/completions`. Compat: `/compat/chat/completions` with `model: custom-{slug}/{model}`.
- **Model field**: The gateway passes `model` through to the provider. It does NOT set a default. Clients must always specify the model.

## Workers AI (Embedding — bge-m3)

- **Response format**: `env.AI.run("@cf/baai/bge-m3", { text: "..." })` returns `{ data: [[n1, n2, ...]] }`. The `data` field is ALWAYS a nested array (batch format), even for single text input. Use `Array.from(data[0])` to get a plain `number[]`.
- **TypedArray gotcha**: The inner array may be a TypedArray (Float32Array), not a plain Array. Always convert with `Array.from()` before passing to Vectorize.
- **Health check trap**: Using `Array.isArray()` on a TypedArray returns `false`. Check `.length` instead, or convert first.

## Vectorize

- **Response format**: `VECTORIZE.query()` returns `{ matches: [...], count: N }`. The field is `matches`, NOT `data` (unlike the REST API which uses `data`).
- **Metadata values**: Must be strings. `null` values cause issues — omit the key entirely or use empty string `""`.
- **Metadata size limit**: 10 KiB per vector.
- **Index naming**: Use `{name}-{embedding-model}` convention for self-documenting indexes (e.g., `gaia-docs-bge-m3`).
- **Multi-index Workers**: A Worker can have multiple `[[vectorize]]` bindings with different `binding` names.

## D1

- **JSON columns**: SQLite `json1` extension is available. Store extensible data as JSON in TEXT columns, query with `json_extract()`.
- **Remote vs local**: `wrangler d1 execute` defaults to local. Add `--remote` to execute against the production database.
- **Secret handling**: Use `wrangler secret put <name>` for sensitive values; they're encrypted at rest.

## General

- **ExecutionContext**: Cannot instantiate `new ExecutionContext()`. It's passed by the runtime to `fetch(request, env, ctx)`. Always accept it in the handler signature.
- **Wrangler auth**: OAuth login (`wrangler login`) works for most operations. Setting `CF_API_TOKEN`/`CF_ACCOUNT_ID` env vars can conflict with OAuth — unset them if using OAuth.
- **Env var naming**: `CF_ACCOUNT_ID` and `CF_API_TOKEN` are deprecated in newer wrangler. Use `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
