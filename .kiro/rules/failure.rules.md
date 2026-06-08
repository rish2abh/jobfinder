# Failure Handling Rules

Rules governing error classification, retry logic, escalation, and reporting during skill execution.

## 1. Transient Errors — Retry

Errors classified as transient:
- Network timeout exceeding 30 seconds
- Ollama service unresponsive (connection refused or no response)
- SMTP temporary failure (4xx status code)

**Action:** Retry the failed operation once after a 5-second pause. If retry fails, proceed to §2.

## 2. Stop Condition

After **2 consecutive failures** on the same operation, stop retrying and report:
- Operation name (e.g., `generate-email-template`, `send-email`)
- Number of failed attempts
- Last error message and code

Do not retry further. Await user direction.

## 3. Escalation — User Input Required

When a failure requires user input, ask a question containing:
1. **Error category** (e.g., missing credentials, permission error, ambiguous intent)
2. **Affected resource** (file path, service name, or operation)
3. **Suggested resolution** or list of options to choose from

Escalate immediately without retry for user-required errors (see §5).

## 4. Partial Success — Batch Operations

When a batch operation (bulk email, multi-source scrape) partially fails, report:
- Count of succeeded items
- Count of failed items
- For each failed item: item identifier and failure reason

Continue processing remaining items unless Stop Condition (§2) triggers.

## 5. Agent-Fixable vs User-Required Boundary

### Agent-fixable (resolve automatically):
- Typos in configuration values
- Missing import statements
- Wrong or misspelled file paths

### User-required (escalate immediately):
- Missing environment variables
- External service outages
- Architectural decisions
- Missing credentials or permission errors

## 6. Uncategorized Errors

For any error not matching categories §1–§5:
- Report the raw error message
- Include context: file path, line number (if available), operation name
- Ask the user how to proceed — do not retry automatically
