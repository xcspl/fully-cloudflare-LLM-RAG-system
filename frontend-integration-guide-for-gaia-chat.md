# gAIa Chatbot Widget — Frontend Integration Guide

API contract for building a chat UI on any framework (React, React Native, Vue, vanilla JS). A working vanilla JS implementation exists — request it if you need reference code.

The API/backend runs on Cloudflare Workers. "Worker" in this guide means the Cloudflare Worker serving the chat API — your frontend just calls it over HTTPS. Nothing about your frontend infrastructure is prescribed.

## Endpoint

```
POST https://gaia-api.earth-team.org/chat
Content-Type: application/json
```

CORS: `*` (temporary — will be locked to allowed origins). Native apps (Android/iOS) don't enforce CORS at all; this only matters for web.

**About auth**: The gAIa Worker does NOT issue JWTs. It validates them. Your app's backend issues a JWT to the user. The frontend sends it to gAIa. gAIa calls your backend's `/verify` endpoint to check it. Today the Worker ignores it — but your frontend should send it now so you're ready when validation turns on.

## Request

The request body MUST be JSON. The `Content-Type: application/json` header is required — the Worker rejects requests without it.

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
| `session_id` | Yes | — | Per-conversation identifier. Generate with **UUIDv7** (RFC 9562, time-sortable, monotonic) on each new session. Reuse across messages for continuity |
| `stream` | No | `true` | `true` = SSE streaming, `false` = JSON |

HTTP header:

| Header | Required | Notes |
|--------|----------|-------|
| `Authorization: Bearer <jwt>` | **No** (optional, future) | YOUR backend's JWT, not ours. The Worker will call your backend's `/verify` to validate it. Send it now so your frontend is ready — the Worker ignores it today |

## Response: SSE Streaming (`stream: true`, default)

The Worker uses this path when the LLM answers directly (no knowledge-base search). Content-Type: `text/event-stream`.

**Important**: Do not assume the response type. Always check `Content-Type` (see below). The Worker may return JSON instead if the LLM performed a knowledge-base search.

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
      if (content) { /* render content in your UI — this is incremental, not replace */ }
    } catch {}
  }
}
```

## Response: JSON

The Worker uses this path when the LLM performed a knowledge-base search (backend limitation prevents streaming after tool use). Also used when the client explicitly sets `"stream": false`. Content-Type: `application/json`.

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

Worker loads the last 50 messages of a session as LLM context. History is stored server-side — your client persists it by saving and reusing the `session_id`. If `session_id` is lost, past sessions for the same `user_id` can be retrieved via `GET /chat/history?user_id=X`.

## Stop / Cancel

```javascript
let controller = null;

async function sendMessage(text) {
  controller = new AbortController();
  try {
    const response = await fetch("https://gaia-api.earth-team.org/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, user_id: userId, session_id: sessionId }),
      signal: controller.signal,
    });
    // ... handle response ...
  } catch (err) {
    if (err.name === "AbortError") {
      // Request was cancelled — keep whatever streamed so far
    } else {
      // Network or other error
    }
  }
}

function onStopClick() {
  if (controller) controller.abort();
}
```

## Think blocks

Minimax M2.7 wraps CoT reasoning in `<think>...</think>`. You choose how to handle them:

- **Strip** — remove entirely, user never sees them:
  ```javascript
  text.replace(/<\/think>/g, "").replace(/<think>[\s\S]*?<\/think>/g, "")
  ```
- **Toggle** — collapse behind a clickable "Show reasoning" (gAIa's approach)
- **Ignore** — display inline (verbose, but transparent)

The tags arrive as raw text in the SSE stream and JSON response. Filter before rendering to DOM.

## Streaming UX patterns

Implement these for a polished chat experience. See the reference implementation for working vanilla JS examples.

### Status indicators

Show what the LLM is doing while the user waits. Use three word pools, cycle randomly every 2 seconds:

- **Thinking**: `["Thinking…","Analyzing…","Processing…","Reasoning…","Contemplating…"]`
- **Searching**: `["Searching knowledge base…","Looking that up…","Finding information…","Consulting sources…","Fetching data…"]`
- **Waiting**: `["Working on it…","Almost there…","Getting ready…","Hang tight…"]`

Animate with an ellipsis after each word (CSS `::after` animation with `content: "" → "." → ".." → "..."`).

### State detection

Detect LLM state from the SSE stream content:

| State | Trigger | Status to show |
|-------|---------|----------------|
| **Thinking** | Raw text contains `<think>` but visible text is empty | Thinking pool |
| **Responding** | Visible text has content | Show words as they arrive |
| **Searching** | Stream aborted (reader cancelled), JSON response follows | Searching pool |
| **Waiting** | Between requests (idle) | Waiting pool |

### Word-by-word streaming

Do NOT buffer the entire response before displaying. Append each `delta.content` chunk to the visible output as it arrives:

```javascript
// React example
const [text, setText] = useState("");
// In SSE reader loop:
if (content) setText(prev => prev + content);
```

Strip `<think>...</think>` blocks from display in real-time — only show text outside think tags. Offer a collapsed toggle later if you want to expose reasoning.

### Animated status in React

```javascript
const THINK = ["Thinking…","Analyzing…","Processing…"];
const SEARCH = ["Searching knowledge base…","Looking that up…"];
const [status, setStatus] = useState(THINK[0]);
const [pool, setPool] = useState("think");

// Cycle every 2s
useEffect(() => {
  if (!isStreaming) return;
  const i = setInterval(() => {
    setStatus(pool === "think" ? pick(THINK) : pick(SEARCH));
  }, 2000);
  return () => clearInterval(i);
}, [isStreaming, pool]);
```

### Stopping mid-response

```javascript
const controller = new AbortController();
fetch("/chat", { signal: controller.signal }); // React: useRef for controller

function onStopClick() {
  controller.abort();
  setStatus(""); // clear status
  setIsStreaming(false);
}
```

Catch `AbortError` in your try/catch — this is expected, not an error. Show whatever text accumulated so far.

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

## Reference implementation

A working vanilla JS implementation exists with full streaming, stop button, think toggle, and session persistence. Request it if you need reference code.

## Quick reference

| Concern | Value |
|---------|-------|
| API URL | `https://gaia-api.earth-team.org` |
| Chat | `POST /chat` |
| History | `GET /chat/history?user_id=X&session_id=Y` |
| Health | `GET /health` |
| Auth | `Authorization: Bearer <your-backend-jwt>` (optional, ignored today) |
| SSE format | `data: {"choices":[{"delta":{"content":"..."}}]}` |
| JSON format | `{"reply": "...", "session_id": "..."}` |
| Session context | Last 50 items |
| Max response | ~15s (LLM CoT + tool calls) |
