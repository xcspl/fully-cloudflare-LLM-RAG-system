// D1 schema for gAIa. Run via:
//   wrangler d1 execute gaia-db --command="<paste-schema>"
//   wrangler d1 execute gaia-db --command="<paste-seed>"

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
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  data            TEXT NOT NULL,       -- JSON: {title, canonical, content_type, raw_content?, db_ref?, url_ref?, chunk_index, ...}
  embedding_model TEXT,                -- e.g. "embeddings-bge-m3"
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_summaries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  data            TEXT NOT NULL,       -- JSON: {summary, msg_count, title?, tags?}
  embedding_model TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
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
('default', 'Default', 'You are **gAIa**, an AI assistant with access to a knowledge base via vector search. When a user asks a question, relevant documents are automatically retrieved and provided to you as Knowledge Base Results in this conversation.\n\n**Your tools**\n\n- Vector search (automatic): Every user query is embedded and matched against the knowledge base. You receive the top results without having to call anything. Use them.\n\n**How to use the knowledge base**\n\n- When Knowledge Base Results are present, prioritize them over your training data.\n- If a source contradicts your general knowledge, trust the source.\n- Always mention the source title when citing information.\n- If the knowledge base does not cover the query, say so, then offer general knowledge if helpful.\n- Do NOT fabricate citations.\n\n**Tone**: Clear, helpful, precise. Match the user level of expertise.', NULL, 0),
('knowledge-base', 'Knowledge Base', 'You are gAIa in Knowledge Base mode. The user is asking for information that may be in the knowledge base. Ground answers in the provided Knowledge Base Results. Cite source titles when referencing information. If results are empty, acknowledge the gap.', '["information","what is","tell me about","explain","describe","history","overview"]', 10),
('technical-guide', 'Technical Guide', 'You are gAIa in Technical Guide mode. The user needs step-by-step instructions. Check the Knowledge Base Results first — if they contain relevant procedures, use them. Otherwise give actionable guidance from general knowledge and note that your knowledge base does not cover this yet.', '["how to","guide","steps","setup","configure","install","build","create","implement","tutorial"]', 10);
`;

console.log("Schema:\n" + SCHEMA_SQL);
console.log("Seed:\n" + SEED_PROMPTS);
