# Ingestion Data

Place raw documents here for ingestion. Supported formats:
- `.md` — Markdown files
- `.txt` — Plain text
- `.json` — JSON with a `content` field (or array of `{ content, title?, metadata? }`)
- `.pdf` — PDF documents (requires `pdf-parse` dependency)
- URLs — listed in `ingest/src/sources.ts`, fetched and parsed at ingest time

## Structure

Organize files by source/domain if needed:
```
data/
├── docs/
│   ├── guide-1.md
│   └── reference.txt
├── policies/
│   └── terms.md
└── urls.txt     # one URL per line
```

Files here are gitignored by default (add to `.gitignore` in ingest root if needed).
