#!/usr/bin/env python3
"""
Create CF AI Gateway and configure Minimax as a custom provider.

Usage:
    python scripts/setup-gateway.py

Reads CF_ACCOUNT_ID and CF_API_TOKEN from ../.env.
Set CF_AI_GATEWAY_NAME to use an existing gateway instead of creating one.
"""

import os
import sys
import json
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)


def load_env() -> dict:
    """Load variables from .env file."""
    env = {}
    env_path = os.path.join(PROJECT_DIR, ".env")
    if not os.path.exists(env_path):
        print("Error: .env file not found. Copy .env.example to .env and fill in values.")
        sys.exit(1)

    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def cf_api(account_id: str, token: str, method: str, path: str, body: dict | None = None) -> dict:
    """Call Cloudflare API."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/{path}"
    data = json.dumps(body).encode() if body else None

    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def create_gateway(account_id: str, token: str, name: str) -> dict:
    """Create a new AI Gateway."""
    print(f"\nCreating AI Gateway: {name} ...")
    result = cf_api(
        account_id, token, "POST",
        "ai-gateway/gateways",
        {"name": name, "enable": True},
    )
    if result.get("success"):
        gw = result["result"]
        print(f"  Gateway created: {gw['id']}")
        print(f"  Dashboard: https://dash.cloudflare.com/{account_id}/ai/ai-gateway/gateways/{gw['id']}")
        return gw
    else:
        errors = result.get("errors", [])
        for e in errors:
            print(f"  Error: {e.get('message', e)}")
        sys.exit(1)


def list_gateways(account_id: str, token: str) -> list:
    """List existing AI Gateways."""
    result = cf_api(account_id, token, "GET", "ai-gateway/gateways")
    return result.get("result", []) if result.get("success") else []


def create_custom_provider(account_id: str, token: str, gateway_id: str, provider: dict) -> dict:
    """Create a custom provider on a gateway."""
    slug = provider["slug"]
    print(f"\nCreating custom provider: {slug} ...")
    result = cf_api(
        account_id, token, "POST",
        f"ai-gateway/gateways/{gateway_id}/providers",
        provider,
    )
    if result.get("success"):
        p = result["result"]
        print(f"  Provider created: {p['id']}")
        print(f"  Slug: {p['slug']}")
        return p
    else:
        errors = result.get("errors", [])
        for e in errors:
            msg = e.get("message", str(e))
            if "already exists" in str(msg).lower() or "duplicate" in str(msg).lower():
                print(f"  Provider already exists (slug taken).")
                return {"slug": provider["slug"], "id": "existing"}
            print(f"  Error: {msg}")
        sys.exit(1)


def main():
    env = load_env()

    account_id = env.get("CF_ACCOUNT_ID", "")
    token = env.get("CF_API_TOKEN", "")
    gateway_name = env.get("CF_AI_GATEWAY_NAME", "gaia-gateway")

    if not account_id or not token:
        print("Error: CF_ACCOUNT_ID and CF_API_TOKEN must be set in .env")
        sys.exit(1)

    # Step 1: Find or create gateway
    existing = list_gateways(account_id, token)
    gateway = None
    for gw in existing:
        if gw.get("name") == gateway_name:
            gateway = gw
            print(f"Using existing gateway: {gw['name']} ({gw['id']})")
            break

    if not gateway:
        gateway = create_gateway(account_id, token, gateway_name)

    gateway_id = gateway["id"]

    # Step 2: Create Minimax custom provider
    minimax_provider = {
        "name": "Minimax",
        "slug": "minimax",
        "base_url": "https://api.minimax.io",
        "description": "Minimax LLM provider — OpenAI-compatible API",
        "enable": True,
    }

    create_custom_provider(account_id, token, gateway_id, minimax_provider)

    # Step 3: Print config for Worker
    print("\n" + "=" * 60)
    print("Add to .env:")
    print(f"  CF_AI_GATEWAY_ID={gateway_id}")
    print()
    print("Gateway URL for Worker LLM_BASE_URL:")
    print(f"  https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/custom-minimax/v1")
    print()
    print("Worker secrets to set:")
    print("  wrangler secret put LLM_API_KEY")
    print("  wrangler secret put CF_AI_GATEWAY_TOKEN")
    print("=" * 60)


if __name__ == "__main__":
    main()
