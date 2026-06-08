# Output Format Rules

These formatting constraints apply to all agent responses during spec/task execution.

## Rules

1. **Code changes** — Present as unified diffs showing only modified lines. Each diff block
   MUST be preceded by a dedicated line containing the relative file path.
   Do NOT output full file contents.

2. **Structured data** — All extraction results, query results, and status reports MUST be
   formatted as JSON.

3. **Explanatory text** — Maximum 5 lines, each line ≤120 characters. Use direct, factual
   language. Prohibited qualifiers: "maybe", "perhaps", "I think", "it seems", "probably".

4. **Error reports** — Exactly three fields, one per line (3 lines or fewer total):
   - Error type
   - Affected component
   - Suggested resolution

5. **Multi-file changes** — Present each change sequentially. Each diff MUST be preceded by
   a single summary line (≤80 characters) describing the change.

6. **No repetition** — Do not repeat information present in the immediately preceding user
   message or any prior agent response within the same conversation session.

## Fallback Behavior

If this file (`.kiro/rules/output.rules.md`) is missing or cannot be parsed, the Agent
proceeds without output formatting constraints and emits a single-line warning:
`WARNING: output.rules.md not loaded — formatting constraints inactive.`
