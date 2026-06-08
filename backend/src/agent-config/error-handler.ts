/**
 * Error Handler — implements error classification, retry logic,
 * partial success reporting, and validation failure reporting
 * as defined in failure.rules.md.
 */

// --- Error Classification (Property 13) ---

export type ErrorCategory = 'transient' | 'agent-fixable' | 'user-required';

export interface ClassifiedError {
  category: ErrorCategory;
  operation: string;
  message: string;
  raw?: unknown;
}

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /network/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ollama.*unresponsive/i,
  /smtp\s*4\d{2}/i,
  /4\d{2}/,
];

const AGENT_FIXABLE_PATTERNS = [
  /typo/i,
  /missing import/i,
  /wrong.*path/i,
  /file not found/i,
  /cannot find module/i,
  /import.*not found/i,
];

const USER_REQUIRED_PATTERNS = [
  /missing.*env/i,
  /environment variable/i,
  /service.*outage/i,
  /permission/i,
  /unauthorized/i,
  /architectural/i,
  /credential/i,
  /5\d{2}/,
];

/**
 * Classifies an error into exactly one category:
 * - transient: network timeout >30s, Ollama unresponsive, SMTP 4xx
 * - agent-fixable: typos in config, missing imports, wrong file paths
 * - user-required: missing env vars, external service outages, architectural decisions
 */
export function classifyError(
  error: string | Error,
  operation: string,
): ClassifiedError {
  const message = typeof error === 'string' ? error : error.message;

  if (TRANSIENT_PATTERNS.some((p) => p.test(message))) {
    return { category: 'transient', operation, message };
  }

  if (AGENT_FIXABLE_PATTERNS.some((p) => p.test(message))) {
    return { category: 'agent-fixable', operation, message };
  }

  if (USER_REQUIRED_PATTERNS.some((p) => p.test(message))) {
    return { category: 'user-required', operation, message };
  }

  // Default: user-required (safest escalation path for uncategorized)
  return { category: 'user-required', operation, message, raw: error };
}

// --- Retry and Stop Logic (Property 14) ---

export interface RetryResult {
  success: boolean;
  attempts: number;
  lastError?: string;
  output?: unknown;
  stopped: boolean;
}

/**
 * Executes an operation with retry logic:
 * - On transient error: retry once after delayMs
 * - After 2 consecutive failures: stop and report
 */
export async function executeWithRetry(
  operation: () => Promise<unknown>,
  options: { delayMs?: number } = {},
): Promise<RetryResult> {
  const delayMs = options.delayMs ?? 5000;
  let attempts = 0;
  let lastError: string | undefined;

  for (let i = 0; i < 2; i++) {
    attempts++;
    try {
      const output = await operation();
      return { success: true, attempts, output, stopped: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      // Only retry if it's the first attempt
      if (i === 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // 2 consecutive failures → stop
  return { success: false, attempts, lastError, stopped: true };
}

// --- Partial Success Reporting (Property 15) ---

export interface BatchItemResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface PartialSuccessReport {
  total: number;
  succeeded: number;
  failed: number;
  failures: { id: string; reason: string }[];
}

/**
 * Generates a partial success report from batch item results.
 * Reports succeeded count, failed count, and per-item failure reasons.
 */
export function generatePartialSuccessReport(
  results: BatchItemResult[],
): PartialSuccessReport {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const failures = results
    .filter((r) => !r.success)
    .map((r) => ({ id: r.id, reason: r.error || 'Unknown error' }));

  return {
    total: results.length,
    succeeded,
    failed,
    failures,
  };
}

// --- Validation Failure Reporting (Property 12) ---

export interface ValidationFailureReport {
  ruleNumber: string;
  failingValue: string;
  correctiveAction: string;
}

/**
 * Creates a validation failure report with exactly three elements:
 * rule number, failing value, and corrective action.
 */
export function createValidationFailureReport(
  ruleNumber: string,
  failingValue: string,
  correctiveAction: string,
): ValidationFailureReport {
  return { ruleNumber, failingValue, correctiveAction };
}
