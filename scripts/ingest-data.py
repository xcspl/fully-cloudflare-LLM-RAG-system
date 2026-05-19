#!/usr/bin/env python3
"""
Send JSON data files to the gAIa Worker /ingest endpoint.

Usage:
    python scripts/ingest-data.py <json-file> [<json-file> ...]
    python scripts/ingest-data.py data-ingest/*.json

Requires .env with CF_AIG_TOKEN and WORKER_URL set.
"""

import os
import sys
import json
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)


def load_env() -> dict:
    env = {}
    env_path = os.path.join(PROJECT_DIR, ".env")
    if not os.path.exists(env_path):
        print("Error: .env file not found")
        sys.exit(1)
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def ingest(worker_url: str, token: str, filepath: str) -> bool:
    with open(filepath) as f:
        payload = json.load(f)

    # Validate required fields
    required = ["data", "key_keys", "source"]
    for field in required:
        if field not in payload:
            print(f"  ERROR: '{field}' missing in {filepath}")
            return False

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{worker_url}/ingest",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "cf-aig-authorization": f"Bearer {token}",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"  OK: {os.path.basename(filepath)} → id={result.get('id', '?')}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  FAIL: {os.path.basename(filepath)} → HTTP {e.code}: {body[:200]}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/ingest-data.py <json-file> [...]")
        print("       python scripts/ingest-data.py data-ingest/*.json")
        sys.exit(1)

    env = load_env()
    worker_url = env.get("WORKER_URL", "").rstrip("/")
    token = env.get("CF_AIG_TOKEN", "")

    if not worker_url:
        # Default to gAIa worker pattern
        account = env.get("CF_ACCOUNT_ID", "")
        worker_url = f"https://gaia.{account}.workers.dev"
        print(f"WORKER_URL not set, using default: {worker_url}")

    if not token:
        print("Error: CF_AIG_TOKEN not set in .env")
        sys.exit(1)

    files = sys.argv[1:]
    ok = 0
    fail = 0

    for filepath in files:
        if not os.path.exists(filepath):
            print(f"  SKIP: {filepath} not found")
            fail += 1
            continue
        if ingest(worker_url, token, filepath):
            ok += 1
        else:
            fail += 1

    print(f"\nDone: {ok} succeeded, {fail} failed")


if __name__ == "__main__":
    main()
