# System Prompts

Each prompt template maps to a row in the `system_messages` D1 table. The `triggers` JSON array determines when a prompt is auto-selected based on user message keywords.

## Adding a new prompt

1. Create a `.md` file here with the prompt content
2. Add a row to `system_messages` D1 table:
   - `id` — slug matching the filename (without `.md`)
   - `name` — human-readable name
   - `content` — the prompt text
   - `triggers` — JSON array of keywords, e.g. `["guide", "how to", "steps"]`
   - `priority` — higher = checked first (default 0)

The worker checks triggers in priority order and falls back to `default` when nothing matches.
