# AI Gateway Setup

## Overview

All LLM traffic goes through CF AI Gateway. This gives us:
- **Caching**: Repeated queries served from cache (cost savings)
- **Rate limiting**: Prevent abuse
- **Analytics**: Usage tracking across providers
- **Provider abstraction**: Change provider without touching Worker code

## Architecture

```
Worker / External client
        │
        ▼
  CF AI Gateway (gaia-gateway)
        │
        ├── custom-minimax ──► https://api.minimax.io
        └── (future providers)
```

## Setup

### 1. Run the setup script

```bash
cd /home/sumanta/local/Et-App-AI
python scripts/setup-gateway.py
```

This reads `CF_ACCOUNT_ID` and `CF_API_TOKEN` from `.env`, creates the gateway and custom provider, and prints the URLs to add to your config.

### 2. Update .env

```bash
CF_AI_GATEWAY_ID=<printed-by-script>
CF_AI_GATEWAY_TOKEN=<your-cf-token>  # May be same as CF_API_TOKEN

# Worker will use this as LLM_BASE_URL:
# https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-minimax/v1
```

### 3. Set Worker secrets

```bash
cd worker
wrangler secret put LLM_API_KEY
wrangler secret put CF_AI_GATEWAY_TOKEN
```

### 4. Deploy the Worker

```bash
wrangler deploy
```

## How it works

The Worker's `llm.ts` sends requests to:
```
POST https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-minimax/v1/chat/completions
Headers:
  Authorization: Bearer <LLM_API_KEY>         → forwarded to Minimax
  cf-aig-authorization: Bearer <CF_AIG_TOKEN> → gateway auth
Body:
  { "messages": [...], "stream": true }
```

The gateway strips `/custom-minimax` and forwards to `https://api.minimax.io/v1/chat/completions`.

## Changing providers

To switch from Minimax to another provider:
1. Create a new custom provider (e.g., `custom-deepseek`)
2. Update `LLM_BASE_URL` in the Worker to point to the new provider path
3. Update `LLM_API_KEY` to the new provider's key

No code changes needed.

## Manual provider creation

If you prefer the CF API directly:

```bash
curl -X POST \
  https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai-gateway/gateways/$GATEWAY_ID/providers \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Minimax",
    "slug": "minimax",
    "base_url": "https://api.minimax.io",
    "enable": true
  }'
```
