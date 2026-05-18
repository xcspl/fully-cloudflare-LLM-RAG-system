// Run via: wrangler d1 execute gaia-db --file=./scripts/schema.sql
// Or manually: npx wrangler d1 execute gaia-db --command="<SQL>"

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  triggers    TEXT,
  priority    INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  title       TEXT NOT NULL,
  canonical   TEXT NOT NULL,       -- What is vectorized (always stored)
  content_type TEXT NOT NULL DEFAULT 'inline',  -- 'inline' | 'db_ref' | 'url'
  raw_content TEXT,                -- Inline content (when content_type = 'inline')
  db_ref      TEXT,                -- JSON: { "db": "gaia-db", "query": "SELECT ...", "params": [...] }
  url_ref     TEXT,                -- Full URL to fetch (when content_type = 'url')
  chunk_index INTEGER NOT NULL,
  metadata    TEXT,
  embedding_model TEXT,            -- e.g. "embeddings-bge-m3", "embeddings-gemini-embedding-2"
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  messages    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
`;

const SEED_PROMPTS = `
INSERT OR IGNORE INTO system_messages (id, name, content, triggers, priority) VALUES
('default', 'Default', 'You are gAIa, an AI assistant with access to a knowledge base. You answer questions helpfully and accurately, drawing on provided context when relevant. If you do not know something, say so. Keep responses concise.', NULL, 0),
('knowledge-base', 'Knowledge Base', 'You are gAIa in Knowledge Base mode. Ground answers in the provided context. Cite specific documents when referencing information. Acknowledge gaps if the knowledge base has partial information.', '["information","what is","tell me about","explain","describe","history","overview"]', 10),
('technical-guide', 'Technical Guide', 'You are gAIa in Technical Guide mode. Provide actionable, step-by-step instructions. Tailor recommendations to what the user has told you about their context. Highlight prerequisites, dependencies, and potential pitfalls.', '["how to","guide","steps","setup","configure","install","build","create","implement","tutorial"]', 10);
`;

console.log("Bootstrap SQL:\n");
console.log(SCHEMA_SQL);
console.log(SEED_PROMPTS);
console.log("\n---");
console.log("Run: wrangler d1 execute gaia-db --command=\"<paste-schema-first>\"");
console.log("Then: wrangler d1 execute gaia-db --command=\"<paste-seed-second>\"");
