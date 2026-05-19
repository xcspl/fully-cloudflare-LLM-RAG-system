export interface ToolCall {
  id?: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments: string;
  };
  // Convenience accessors (set by parseLlmResponse)
  name?: string;
  arguments?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ChatRequest {
  message: string;
  user_id: string;
  session_id?: string;
  stream?: boolean;  // default true — SSE streaming vs plain JSON
}

export interface Session {
  id: string;
  user_id: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface IngestRequest {
  data: Record<string, unknown>;
  key_keys: string[];
  source: string;
  external_url?: string | null;
}

export type ContentType = "inline" | "db_ref" | "url";

export interface DbRef {
  db: string;
  query: string;
  params: unknown[];
}

export interface DocumentData {
  title: string;
  canonical: string;
  content_type: ContentType;
  raw_content?: string;
  db_ref?: DbRef;
  url_ref?: string;
  chunk_index: number;
  [key: string]: unknown;  // extensible
}

export interface Document {
  id: string;
  source: string;
  data: DocumentData;       // parsed from JSON column
  embedding_model: string | null;
  created_at: string;
}

export interface SystemMessage {
  id: string;
  name: string;
  content: string;
  triggers: string | null;
  priority: number;
}

export interface VectorizeMetadata {
  canonical_text: string;           // What was vectorized
  d1_db_id: string;                // D1 database name, e.g. "gaia-db"
  d1_row_id: string;               // D1 row UUID (our doc_id)
  external_url: string | null;     // Optional external source URL
  embedding_model: string;         // e.g. "embeddings-bge-m3"
}

export interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: VectorizeMetadata;
}
