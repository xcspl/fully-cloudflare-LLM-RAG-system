import type { ChatMessage, ToolCall } from "./types";
import type { ToolDefinition } from "./tools";

export type ApiMode = "openai" | "anthropic";

export interface LlmConfig {
  gatewayToken: string;
  baseUrl: string;
  providerSlug: string;
  model: string;
  apiMode: ApiMode;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[] | null;
  finishReason: string;
}

export async function callLlm(
  config: LlmConfig,
  messages: ChatMessage[],
  options: {
    stream?: boolean;
    tools?: ToolDefinition[];
    maxTokens?: number;
  } = {},
): Promise<Response> {
  const stream = options.stream ?? true;
  const path = config.apiMode === "anthropic"
    ? `${config.baseUrl}/${config.providerSlug}/v1/messages`
    : `${config.baseUrl}/${config.providerSlug}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  };

  if (options.tools?.length) {
    body.tools = options.tools;
  }

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  } else if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
  }

  if (config.apiMode === "anthropic") {
    body.max_tokens = config.maxTokens ?? 4096;
  }

  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${config.gatewayToken}`,
    },
    body: JSON.stringify(body),
  });
}

// Parse a non-streaming LLM response into LlmResponse
export function parseLlmResponse(data: Record<string, unknown>): LlmResponse {
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
  if (!choice) return { content: null, toolCalls: null, finishReason: "error" };

  const message = choice.message as Record<string, unknown> | undefined;
  const finishReason = (choice.finish_reason as string) ?? "error";

  // Tool calls — preserve full structure (Minimax needs index, type, function)
  const rawCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
  if (rawCalls?.length) {
    const toolCalls: ToolCall[] = rawCalls.map((tc) => ({
      id: tc.id as string,
      index: tc.index as number,
      type: (tc.type as string) ?? "function",
      function: tc.function as { name: string; arguments: string },
      // Convenience
      name: (tc.function as Record<string, string>)?.name ?? "",
      arguments: (tc.function as Record<string, string>)?.arguments ?? "{}",
    }));
    return { content: null, toolCalls, finishReason };
  }

  // Regular content
  return {
    content: (message?.content as string) ?? null,
    toolCalls: null,
    finishReason,
  };
}
