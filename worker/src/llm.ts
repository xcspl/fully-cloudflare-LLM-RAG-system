import type { ChatMessage } from "./types";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;        // https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-minimax/v1
  gatewayToken?: string;  // CF AI Gateway token (cf-aig-authorization header)
}

export async function callLlm(
  config: LlmConfig,
  messages: ChatMessage[],
  stream: boolean = true,
): Promise<Response> {
  const url = `${config.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  if (config.gatewayToken) {
    headers["cf-aig-authorization"] = `Bearer ${config.gatewayToken}`;
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, stream }),
  });
}
