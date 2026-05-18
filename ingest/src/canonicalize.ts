// Step 1 of the ingestion pipeline.
// Calls the canonicalization LLM to distill a raw chunk into clean,
// fact-dense canonical text that will be vectorized by bge-m3.
//
// This module is provider-agnostic — it uses the same OpenAI-compatible
// /chat/completions interface as the chat LLM, just with a different
// system prompt and (optionally) a different provider/model.

export interface CanonicalizeConfig {
  apiKey: string;
  baseUrl: string;
}

const CANONICALIZE_PROMPT = `You are a document canonicalizer. Given a raw text chunk, produce a clean, fact-dense canonical version.

Rules:
- Preserve ALL factual information, names, numbers, and details
- Remove filler words, conversational language, and redundancy
- Use a consistent, neutral tone
- Keep the original structure: key points stay in their logical order
- If the raw text contains metadata (title, author, date, etc.), include it
- Output ONLY the canonical text, no preamble or commentary

Raw text:
`;

export async function canonicalize(
  config: CanonicalizeConfig,
  rawChunk: string,
): Promise<string> {
  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: CANONICALIZE_PROMPT },
        { role: "user", content: rawChunk },
      ],
      stream: false,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Canonicalization failed: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices: [{ message: { content: string } }];
  };

  return data.choices[0].message.content.trim();
}
