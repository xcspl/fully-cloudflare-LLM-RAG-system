# Data Ingest

This directory contains the knowledge base data for gAIa. It is kept in a **private repository** because it contains organization-specific information.

## Setup

```bash
# Clone the private data repository into this directory
git clone git@github.com:earthteam/gaia-data.git data-ingest/
```

## Structure

```
data-ingest/
├── www.earth-team.org/    # EarthTeam website content
├── www.freeland.org/       # Freeland website content
├── earth-credits/          # Earth Credits guide
└── sample.json             # Example entry format
```

## Format

See `sample.json` for the entry format. Each JSON file contains a `entries` array with `data`, `key_keys`, `source`, and optional `source_url` fields.
