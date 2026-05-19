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
import hashlib
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)


def make_slug(source: str, data: dict) -> str:
    """Deterministic slug from source + full data. Any data change = new slug."""
    raw = source + json.dumps(data, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()[:12]


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


def send_entry(worker_url: str, _token: str, entry: dict, label: str) -> bool:
    """Send a single entry to /ingest."""
    data = json.dumps(entry).encode()
    req = urllib.request.Request(
        f"{worker_url}/ingest",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "gAIa-ingest/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"  OK: {label} → id={result.get('id', '?')}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  FAIL: {label} → HTTP {e.code}: {body[:200]}")
        return False


def ingest(worker_url: str, token: str, filepath: str) -> tuple[int, int]:
    """Ingest a JSON file — supports single entry or { entries: [...] } batch."""
    with open(filepath) as f:
        payload = json.load(f)

    fname = os.path.basename(filepath)

    # Batch mode: { "entries": [...] }
    if "entries" in payload and isinstance(payload["entries"], list):
        entries = payload["entries"]
        ok = fail = 0
        for i, entry in enumerate(entries):
            required = ["data", "key_keys", "source"]
            if all(k in entry for k in required):
                # Generate deterministic slug for idempotent re-ingestion
                if "slug" not in entry and "id" not in entry:
                    entry["slug"] = make_slug(entry["source"], entry["data"])
                label = f"{fname}#{i+1}"
                if send_entry(worker_url, token, entry, label):
                    ok += 1
                else:
                    fail += 1
            else:
                print(f"  SKIP: {fname}#{i+1} — missing required fields")
                fail += 1
        return (ok, fail)

    # Single entry mode
    required = ["data", "key_keys", "source"]
    if all(k in payload for k in required):
        if send_entry(worker_url, token, payload, fname):
            return (1, 0)
        else:
            return (0, 1)

    print(f"  ERROR: '{fname}' missing required fields (data, key_keys, source)")
    return (0, 1)


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/ingest-data.py <json-file> [...]")
        print("       python scripts/ingest-data.py data-ingest/*.json")
        sys.exit(1)

    env = load_env()
    worker_url = env.get("DATA_WORKER_URL", env.get("WORKER_URL", "")).rstrip("/")
    token = env.get("CF_AIG_TOKEN", "")  # kept for future auth needs

    if not worker_url:
        account = env.get("CF_ACCOUNT_ID", "")
        worker_url = f"https://gaia-data.{account}.workers.dev"
        print(f"DATA_WORKER_URL not set, using default: {worker_url}")

    files = sys.argv[1:]
    ok = 0
    fail = 0

    for filepath in files:
        if not os.path.exists(filepath):
            print(f"  SKIP: {filepath} not found")
            fail += 1
            continue
        o, f = ingest(worker_url, token, filepath)
        ok += o
        fail += f

    print(f"\nDone: {ok} succeeded, {fail} failed")


if __name__ == "__main__":
    main()
