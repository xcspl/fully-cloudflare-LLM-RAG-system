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
      "Search the knowledge base (hybrid keyword + semantic). On the FIRST call for a topic, do NOT set tune or count — use defaults. If results seem insufficient: too many weak results → retry with tune='sharp' and lower count. Too few results → retry with tune='wide' and higher count. Formulate a specific, keyword-rich search query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A specific search query with relevant keywords to find matching documents in the knowledge base",
        },
        tune: {
          type: "string",
          enum: ["sharp", "normal", "wide"],
          description:
            "Search quality mode. Do NOT set on first call. Use 'sharp' to tighten (fewer, more relevant), 'wide' to broaden (more, exploratory).",
        },
        count: {
          type: "number",
          description:
            "How many results to return (default 5). Set higher with wide, lower with sharp.",
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
      "Search past conversation history for this user. Call this when the user references something discussed earlier or asks about previous conversations. Set search_all_sessions to true to search across all past sessions, not just the current one.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keywords or topic to search for in past conversations",
        },
        search_all_sessions: {
          type: "boolean",
          description:
            "Set to true to search all past sessions for this user, not just the current conversation",
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
