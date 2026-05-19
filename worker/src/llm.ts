import type { ChatMessage } from "./types";

export type ApiMode = "openai" | "anthropic";

export interface LlmConfig {
  gatewayToken: string;  // cf-aig-authorization header (provider key stored in gateway)
  baseUrl: string;       // https://gateway.ai.cloudflare.com/v1/{account}/{gateway}
  providerSlug: string;  // "custom-minimax"
  model: string;         // "MiniMax-M2.7"
  apiMode: ApiMode;      // "openai" → /v1/chat/completions | "anthropic" → /v1/messages
  maxTokens?: number;    // Required for anthropic mode (default 4096)
}

export async function callLlm(
  config: LlmConfig,
  messages: ChatMessage[],
  stream: boolean = true,
): Promise<Response> {
  const path = config.apiMode === "anthropic"
    ? `${config.baseUrl}/${config.providerSlug}/v1/messages`
    : `${config.baseUrl}/${config.providerSlug}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  };

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
