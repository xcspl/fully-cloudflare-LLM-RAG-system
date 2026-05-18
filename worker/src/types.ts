export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  user_id: string;
  session_id?: string;
}

export interface Session {
  id: string;
  user_id: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export type ContentType = "inline" | "db_ref" | "url";

export interface DbRef {
  db: string;        // D1 binding name, e.g. "DB", "gaia-db"
  query: string;     // SQL query
  params: unknown[]; // Bound parameters
}

export interface Document {
  id: string;
  source: string;
  title: string;
  canonical: string;
  content_type: ContentType;
  raw_content: string | null;     // inline
  db_ref: string | null;          // JSON: DbRef
  url_ref: string | null;         // URL
  chunk_index: number;
  metadata: string | null;
  embedding_model: string | null;  // e.g. "embeddings-bge-m3"
  created_at: string;
}

export interface SystemMessage {
  id: string;
  name: string;
  content: string;
  triggers: string | null;
  priority: number;
}

export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: {
    doc_id: string;
    source: string;
    title: string;
    chunk_index: number;
    embedding_model: string;       // e.g. "embeddings-bge-m3"
  };
}
