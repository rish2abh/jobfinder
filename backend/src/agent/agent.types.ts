/**
 * BullMQ queue and job constants for the Agent orchestrator.
 */
export const AGENT_RUN_QUEUE = 'agent-run';
export const AGENT_RUN_JOB = 'run-agent';

/**
 * Payload submitted to the agent queue.
 */
export interface AgentRunJobData {
  userId: string;
  message: string;
  conversationId: string;
}

/**
 * Result returned when the agent run completes.
 */
export interface AgentRunJobResult {
  runId?: string;
  summary?: string;
  response: string;
  actions: AgentAction[];
  conversationId: string;
  iterations: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

/**
 * Status snapshot for polling from the frontend.
 */
export interface AgentRunStatus {
  jobId: string;
  state: string;
  progress: number;
  result: AgentRunJobResult | null;
  failedReason: string | null;
}
