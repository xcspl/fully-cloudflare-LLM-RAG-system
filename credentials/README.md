# Credentials

This directory stores API keys, service tokens, and connection configs. **Everything here is .gitignored.**

## Files

| File | Purpose | How to obtain |
|------|---------|---------------|
| `.env` | LLM and CF vars | Copy from `../.env.example`, fill in values |
| `wrangler.toml` secrets | `LLM_API_KEY` | Set via `wrangler secret put LLM_API_KEY` |

## Required credentials

| Variable | Where | Notes |
|----------|-------|-------|
| `LLM_API_KEY` | `.env` + `wrangler secret` | API key for the LLM provider |
| `LLM_BASE_URL` | `.env` + `wrangler.toml [vars]` | Base URL for the LLM API |
| `CF_API_TOKEN` | `.env` | Cloudflare API token for Wrangler |
| `CF_ACCOUNT_ID` | `.env` | Cloudflare account ID |

## Obtaining a CF_API_TOKEN

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Create token with permissions: Account.Workers AI, Account.D1, Account.Vectorize, Account.Workers Scripts
