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

export const GET_CURRENT_TIME: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description:
      "Get the current time in GMT plus key timezones. Call this when the user asks what time it is, what day it is, or needs temporal context.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const SEARCH_CHAT_HISTORY: ToolDefinition = {
  type: "function",
  function: {
    name: "search_chat_history",
    description:
      "Search past conversation history for this user. Call this when the user references something discussed earlier or asks about previous conversations. Returns relevant past messages.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords or topic to search for in past conversations",
        },
      },
      required: ["query"],
    },
  },
};

// export const WEB_SEARCH: ToolDefinition = {
//   type: "function",
//   function: {
//     name: "web_search",
//     description:
//       "Search the internet for current information. Call this when the knowledge base doesn't have what the user needs and the information might be on the web.",
//     parameters: {
//       type: "object",
//       properties: {
//         query: {
//           type: "string",
//           description: "Search query for the web",
//         },
//       },
//       required: ["query"],
//     },
//   },
// };

export const ALL_TOOLS: ToolDefinition[] = [
  SEARCH_KNOWLEDGE_BASE,
  GET_CURRENT_TIME,
  SEARCH_CHAT_HISTORY,
  // WEB_SEARCH,
];
