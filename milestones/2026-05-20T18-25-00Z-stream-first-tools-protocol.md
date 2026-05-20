# Milestone: Stream-First Tool Calling & Protocol Hygiene

**Date**: 2026-05-20 18:25 GMT  
**Chapter**: SSE tool detection, proper protocol reconstruction, animated UX

---

## What Changed

### Tool Loop Upgrade

- **6-round cap** (from 3) — LLM can chain searches freely
- **Removed premature `break toolLoop`** on no results — LLM processes tool results naturally through the loop
- **Stream-first**: round 0 uses streaming (SSE) to detect tool_calls. If LLM answers directly, user sees words instantly (1 call). If LLM calls tools, stream aborted, tools executed, response via JSON

### Protocol Hygiene

- **DB stores proper protocol metadata**: `assistant(tool_calls)` saved with `tool_calls` in metadata JSON, `tool(result)` saved with `tool_call_id` in metadata JSON
- **`loadChatHistory` reconstructs protocol**: metadata → proper `tool_calls` and `tool_call_id` fields on loaded messages
- **No more user-note flattening**: context uses standard OpenAI/Anthropic protocol pairing
- **Tool results NOT stored in DB**: only the compact marker `[Searched knowledge base: "query"]`. The LLM's assistant response is the interpretation

### Frontend UX

- **Status indicators**: animated word with pulse + ellipsis dots, cycles every 2s from word pools
- **Three word pools**: Thinking (CoT), Searching (tool use), Waiting (idle)
- **State detection**: real-time detection of think blocks → "Thinking...", streaming content → word-by-word display, tool execution → "Searching..."
- **Word-by-word streaming**: SSE content rendered as it arrives, not buffered

### SSE Tool Detection

`readSSEStream()` reads SSE chunks, accumulates `delta.tool_calls`, detects `finish_reason: "tool_calls"`. Properly merges incremental tool_call chunks (name, arguments arrive across multiple SSE lines).

## The Rule

> DB tracks protocol. Context loads protocol. Frontend shows progress. No more hacks.

## Frontend Integration Guide Updated

Added sections: streaming UX patterns, status indicators, state detection, word-by-word streaming, animated status in React, stop handling, CSS animations.
