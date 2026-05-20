# gAIa Chatbot Widget — Frontend Integration Guide

API contract for building a chat UI on any framework (React, React Native, Vue, vanilla JS). Reference implementation: `static/index.html`.

## Endpoint

```
POST https://gaia-api.earth-team.org/chat
Content-Type: application/json
```

No auth required today (future: JWT `Authorization` header). CORS: `*`.

## Request

```json
{
  "message": "What is Earth Credits?",
  "user_id": "web-abc123",
  "session_id": "abc-123-uuid",
  "stream": true
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `message` | Yes | — | User text |
| `user_id` | Yes | — | Per-user identifier. Guest: `"web-" + random`. Persist across sessions |
| `session_id` | Yes | — | Per-conversation identifier. Created on first message, reused for continuity |
| `stream` | No | `true` | `true` = SSE streaming, `false` = JSON |

## Response: SSE Streaming (`stream: true`, default)

When no tool search is needed. Content-Type: `text/event-stream`.

```
data: {"id":"...","choices":[{"delta":{"content":"Hello"}}]}
data: {"id":"...","choices":[{"delta":{"content":" world"}}]}
data: {"id":"...","choices":[{"finish_reason":"stop"}]}
```

Response headers:
- `X-Session-Id: uuid` — save this, send it back on next request
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

### SSE parser (JavaScript)

```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      const json = JSON.parse(line.slice(6));
      const content = json.choices?.[0]?.delta?.content;
      if (content) appendToUI(content);
    } catch {}
  }
}
```

## Response: JSON (`stream: false`, or tool-based)

When tool search fires, the Worker returns JSON (Minimax streaming limitation with tool messages).

```json
HTTP 200
Content-Type: application/json
X-Session-Id: abc-123-uuid

{
  "reply": "Earth Credits are EarthTeam's reward system...",
  "session_id": "abc-123-uuid"
}
```

### Always check Content-Type

```javascript
const isStream = response.headers.get("Content-Type")?.includes("text/event-stream");

if (isStream) {
  // SSE word-by-word
} else {
  // JSON, single response
  const data = await response.json();
  displayMessage(data.reply);
}
```

## Session lifecycle

```javascript
let sessionId = "";       // Empty = new session
const userId = "web-" + Math.random().toString(36).slice(2, 8);

// Every request:
const response = await fetch("https://gaia-api.earth-team.org/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: inputText,
    user_id: userId,
    session_id: sessionId
  })
});

// Capture session on first response:
const id = response.headers.get("X-Session-Id");
if (id) sessionId = id;

// New chat button → reset sessionId = ""
```

Worker loads last 50 messages from the session as LLM context. History persists across browser sessions via `session_id`.

## Stop / Cancel

```javascript
const controller = new AbortController();

fetch("https://gaia-api.earth-team.org/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, user_id: userId, session_id: sessionId }),
  signal: controller.signal,
});

// Stop button:
controller.abort();

// Catch:
} catch (err) {
  if (err.name === "AbortError") {
    // Keep whatever streamed so far
  }
}
```

## Think blocks

Minimax M2.7 wraps CoT reasoning in `<think>...</think>`. Strip from display:

```javascript
function stripThink(text) {
  return text.replace(/<\/think>/g, "").replace(/<think>[\s\S]*?<\/think>/g, "");
}
```

See `static/index.html` for accumulating think content into a collapsible toggle.

## Markdown

Minimal rendering:

```javascript
function render(text) {
  return text
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/```(\w*)\n?([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
    .replace(/\n/g, "<br>");
}
```

## Errors

```javascript
try {
  const response = await fetch(...);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    showError(err.error || `HTTP ${response.status}`);
    return;
  }
} catch (err) {
  if (err.name === "AbortError") { /* cancelled */ }
  else if (err.name === "TypeError") { showError("Network error"); }
  else { showError(err.message); }
}
```

Common: `502` (AI Gateway/LLM failure), `400` (invalid body), network drops.

## Reference impl

`static/index.html` — 140 lines, vanilla JS, full streaming, stop button, think toggle, session persistence.

## Quick reference

| Concern | Value |
|---------|-------|
| API URL | `https://gaia-api.earth-team.org` |
| Chat | `POST /chat` |
| History | `GET /chat/history?user_id=X&session_id=Y` |
| Health | `GET /health` |
| Auth | None today (future: JWT Bearer) |
| SSE format | `data: {"choices":[{"delta":{"content":"..."}}]}` |
| JSON format | `{"reply": "...", "session_id": "..."}` |
| Session context | Last 50 items |
| Max response | ~15s (LLM CoT + tool calls) |
