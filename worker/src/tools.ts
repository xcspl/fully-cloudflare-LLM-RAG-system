export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const SEARCH_KNOWLEDGE_BASE: ToolDefinition = {
  type: "function",
  function: {
    name: "search_knowledge_base",
    description:
      "Search the knowledge base for information relevant to the user's query. Call this when the user asks about specific topics, projects, data, or details that may exist in the knowledge base. Formulate a specific, keyword-rich search query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A specific search query with relevant keywords to find matching documents in the knowledge base",
        },
      },
      required: ["query"],
    },
  },
};

export const ALL_TOOLS: ToolDefinition[] = [SEARCH_KNOWLEDGE_BASE];
