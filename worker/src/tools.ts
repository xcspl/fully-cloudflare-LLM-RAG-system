// Tool definitions for future function calling.
// Currently placeholders — will be wired into the Minimax request
// when EarthTeam API access is ready.

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOLS: ToolDefinition[] = [
  // Example:
  // {
  //   name: "get_project",
  //   description: "Fetch a conservation project by ID",
  //   parameters: {
  //     type: "object",
  //     properties: {
  //       project_id: { type: "string", description: "The project UUID" },
  //     },
  //     required: ["project_id"],
  //   },
  // },
];
