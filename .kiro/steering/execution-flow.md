# Execution Flow — Intent Detection & Skill Routing

This steering file is evaluated at the start of every user request. It determines whether the request maps to a defined pipeline intent and, if so, which skills to invoke and in what order.

## Intent Detection Table

Match the user's request text against keyword phrases below using **case-insensitive substring matching**. A match occurs when the request contains any keyword phrase from a category as a substring.

| Intent Category | Keywords (case-insensitive substring) | Skill Sequence |
|---|---|---|
| PDF extraction only | "parse resume", "extract pdf", "parse pdf", "read resume" | `extract-pdf-data` |
| Extract + Store | "parse and save", "extract and store", "upload resume" | `extract-pdf-data` → `store-candidates-db` |
| Email generation + Send | "send outreach", "email candidates", "send email", "bulk mail" | `generate-email-template` → `send-email` |
| Full pipeline | "full pipeline", "end to end", "process resume and email" | `extract-pdf-data` → `store-candidates-db` → `generate-email-template` → `send-email` |

## Matching Rules

1. Normalize the user request to lowercase before matching.
2. For each category, check if the request contains ANY of that category's keyword phrases as a substring.
3. Collect all categories that match.
4. Apply conflict resolution (below) if multiple categories match.

## Conflict Resolution

When a request matches keywords from **2 or more** intent categories:

- Select the category with the **longest skill sequence** (highest skill count).
- Example: if request matches both "PDF extraction only" (1 skill) and "Full pipeline" (4 skills), select "Full pipeline".

## Dependency Rules

Skills have strict input dependencies. A skill MUST NOT execute unless its dependencies are satisfied:

| Skill | Requires |
|---|---|
| `extract-pdf-data` | No predecessor output required |
| `store-candidates-db` | Output from `extract-pdf-data` (parsed candidate JSON) |
| `generate-email-template` | User profile data — from `extract-pdf-data` output OR existing DB record |
| `send-email` | Output from `generate-email-template` (subject + body) OR a user-provided template |

If a dependency is not satisfied, halt and report the missing dependency to the user.

## Pipeline Execution

When a matched intent contains 2+ skills in sequence:

1. Execute skills in the defined order: skill 1 → skill 2 → … → skill N.
2. Pass the **complete output** of skill K as the primary input context to skill K+1.
3. Do not skip skills or reorder them.
4. Validate inputs (via `validation.rules.md`) before each skill invocation.

## Failure Handling

If skill K in a pipeline of N skills fails:

1. **Halt** — do not execute skills K+1 through N.
2. **Report completed** — list skills 1 through K-1 with their outputs.
3. **Report failed** — identify skill K, its error reason, and the input that caused failure.
4. **Report not attempted** — list skills K+1 through N as skipped.
5. **Offer retry** — ask the user if they want to retry the failed skill.

## No-Match Behavior

If the user's request does **not** match any keyword phrase from the intent detection table:

- Do NOT invoke any skill from this steering file.
- Proceed with normal LLM-assisted response generation.
- Do not warn the user about the lack of a match; simply respond naturally.

## Execution Checklist

Before invoking any matched skill sequence:

1. ✅ Intent detected — at least one keyword phrase matched
2. ✅ Conflict resolved — single intent category selected
3. ✅ Dependencies satisfiable — required predecessor outputs available or obtainable
4. ✅ Validation rules loaded — `.kiro/rules/validation.rules.md` is accessible
5. ✅ Inputs validated — all required fields present and valid per validation rules

If any check fails, halt and report which check failed before executing skills.
