import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { GeminiClientService, GeminiMessage, GeminiToolCall, GeminiFunctionDeclaration } from './gemini-client.service';
import { ToolRegistry } from './tools/tool-registry';
import { AgentJournalRepository } from './journal/agent-journal.repository';
import { GuardrailService } from './guardrails/guardrail.service';
import { SYSTEM_PROMPT } from './system-prompt';
import {
  AGENT_RUN_QUEUE,
  AgentRunJobData,
  AgentRunJobResult,
  AgentAction,
} from './agent.types';

/**
 * BullMQ processor that runs the orchestrator reasoning loop.
 *
 * Flow:
 * 1. Receives { userId, message, conversationId } from the queue
 * 2. Sends to Gemini with system prompt + tool declarations
 * 3. If Gemini returns tool calls → validates args → runs guardrails → executes via ToolRegistry
 * 4. Feeds tool results back to Gemini
 * 5. Repeats until Gemini returns text-only or max iterations reached
 * 6. Persists one journal entry per run matching AgentJournal shape
 *
 * IMPORTANT — Gemini 3-series config:
 * Temperature is intentionally left at default (1.0).
 * Setting temperature=0 causes looping and degraded reasoning with function calling.
 */
@Processor(AGENT_RUN_QUEUE, { concurrency: 2 })
export class AgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentProcessor.name);
  private readonly maxIterations: number;

  constructor(
    private readonly geminiClient: GeminiClientService,
    private readonly toolRegistry: ToolRegistry,
    private readonly journalRepo: AgentJournalRepository,
    private readonly guardrails: GuardrailService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.maxIterations = this.configService.get<number>('AGENT_MAX_TOOL_ITERATIONS', 8);
  }

  async process(job: Job<AgentRunJobData, AgentRunJobResult>): Promise<AgentRunJobResult> {
    const { userId, message, conversationId } = job.data;
    const runId = randomUUID();
    const startTime = Date.now();

    this.logger.log(
      `Agent run started — runId: ${runId}, jobId: ${job.id}, user: ${userId}, conv: ${conversationId}`,
    );

    const actions: AgentAction[] = [];
    const messages: GeminiMessage[] = [
      { role: 'user', parts: [{ text: message }] },
    ];

    const tools = this.toolRegistry.getDeclarations();
    let iterations = 0;
    let finalResponse = '';
    let totalTokens = { prompt: 0, completion: 0, total: 0 };

    try {
      while (iterations < this.maxIterations) {
        iterations++;
        await job.updateProgress(Math.round((iterations / this.maxIterations) * 80));

        this.logger.log(`Iteration ${iterations}/${this.maxIterations} — runId: ${runId}`);

        const geminiResponse = await this.geminiClient.generateContent(
          messages,
          SYSTEM_PROMPT,
          tools,
        );

        // Accumulate token usage
        if (geminiResponse.usageMetadata) {
          totalTokens.prompt += geminiResponse.usageMetadata.promptTokenCount ?? 0;
          totalTokens.completion += geminiResponse.usageMetadata.candidatesTokenCount ?? 0;
          totalTokens.total += geminiResponse.usageMetadata.totalTokenCount ?? 0;
        }

        // No tool calls → final response
        if (geminiResponse.toolCalls.length === 0) {
          finalResponse = geminiResponse.text ?? 'Done.';
          break;
        }

        // Build model message with function calls
        const modelParts: GeminiMessage['parts'] = [];
        for (const tc of geminiResponse.toolCalls) {
          modelParts.push({ functionCall: tc });
        }
        if (geminiResponse.text) {
          modelParts.push({ text: geminiResponse.text });
        }
        messages.push({ role: 'model', parts: modelParts });

        // Execute tool calls and build response parts
        const functionResponseParts: GeminiMessage['parts'] = [];

        for (const toolCall of geminiResponse.toolCalls) {
          const actionStart = Date.now();
          const result = await this.executeTool(userId, toolCall, tools);
          const durationMs = Date.now() - actionStart;

          actions.push({ tool: toolCall.name, args: toolCall.args, result, durationMs });
          functionResponseParts.push({
            functionResponse: { name: toolCall.name, response: result },
          });
        }

        messages.push({ role: 'user', parts: functionResponseParts });
      }

      // Hit max iterations without a final text response
      if (!finalResponse) {
        finalResponse =
          `I reached the maximum steps (${this.maxIterations}) for this request. ` +
          `Actions taken: ${actions.map((a) => a.tool).join(', ')}. ` +
          'Let me know if you want me to continue.';
      }

      await job.updateProgress(100);

      // Build summary for the journal
      const summary = this.buildSummary(actions, finalResponse);

      // Persist one journal entry per run
      await this.journalRepo.create({
        runId,
        userId,
        conversationId,
        trigger: 'user_chat',
        userMessage: message,
        agentResponse: finalResponse,
        summary,
        actions,
        iterations,
        tokenUsage: totalTokens,
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
      });

      const result: AgentRunJobResult = {
        runId,
        summary,
        response: finalResponse,
        actions,
        conversationId,
        iterations,
        tokenUsage: totalTokens,
      };

      this.logger.log(
        `Agent run complete — runId: ${runId}, iterations: ${iterations}, ` +
        `actions: ${actions.length}, duration: ${Date.now() - startTime}ms`,
      );

      return result;
    } catch (err: any) {
      this.logger.error(
        `Agent run failed — runId: ${runId}, error: ${err.message}`,
        err.stack,
      );

      // Still journal the failure
      await this.journalRepo.create({
        runId,
        userId,
        conversationId,
        trigger: 'user_chat',
        userMessage: message,
        agentResponse: `Error: ${err.message}`,
        summary: `Failed: ${err.message}`,
        actions,
        iterations,
        tokenUsage: totalTokens,
        durationMs: Date.now() - startTime,
        error: err.message,
        timestamp: new Date(),
      });

      throw err;
    }
  }

  // ── Tool execution with arg validation ─────────────────────────────────────

  private async executeTool(
    userId: string,
    toolCall: GeminiToolCall,
    declarations: GeminiFunctionDeclaration[],
  ): Promise<unknown> {
    const { name, args } = toolCall;

    this.logger.log(`Executing tool: ${name} — args: ${JSON.stringify(args).slice(0, 200)}`);

    // 1. Validate args against the declared parameter schema
    const validationError = this.validateToolArgs(name, args, declarations);
    if (validationError) {
      this.logger.warn(`Arg validation failed for tool ${name}: ${validationError}`);
      // Return the error as a function response so Gemini can self-correct
      return { error: validationError };
    }

    // 2. Guardrail check
    const guardrailResult = await this.guardrails.check(name, args, userId);
    if (!guardrailResult.allowed) {
      this.logger.warn(`Guardrail blocked tool ${name}: ${guardrailResult.reason}`);
      return { error: guardrailResult.reason, blocked: true };
    }

    // 3. Execute
    try {
      return await this.toolRegistry.execute(name, { ...args, userId });
    } catch (err: any) {
      this.logger.error(`Tool ${name} failed: ${err.message}`, err.stack);
      return { error: err.message, tool: name };
    }
  }

  // ── Arg validation against declared schema ─────────────────────────────────

  /**
   * Validates tool call args against the tool's declared parameter schema.
   * Returns an error string if validation fails (missing required arg or wrong type),
   * or null if valid.
   */
  private validateToolArgs(
    toolName: string,
    args: Record<string, unknown>,
    declarations: GeminiFunctionDeclaration[],
  ): string | null {
    const declaration = declarations.find((d) => d.name === toolName);
    if (!declaration) {
      return `Unknown tool "${toolName}". Available tools: ${declarations.map((d) => d.name).join(', ')}`;
    }

    const schema = declaration.parameters;
    const properties = schema.properties;
    const required = schema.required ?? [];

    // Check required parameters
    for (const requiredParam of required) {
      if (!(requiredParam in args) || args[requiredParam] === undefined || args[requiredParam] === null) {
        return `Missing required parameter "${requiredParam}" for tool "${toolName}". ` +
          `Required parameters: [${required.join(', ')}].`;
      }
    }

    // Type-check provided parameters against their declared types
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;

      const propSchema = properties[key] as Record<string, unknown> | undefined;
      if (!propSchema) continue; // extra args are tolerated

      const declaredType = propSchema.type as string | undefined;
      if (!declaredType) continue;

      const typeError = this.checkType(key, value, declaredType, propSchema);
      if (typeError) return typeError;
    }

    return null;
  }

  /**
   * Check a single value against its declared JSON Schema type.
   */
  private checkType(
    paramName: string,
    value: unknown,
    declaredType: string,
    propSchema: Record<string, unknown>,
  ): string | null {
    switch (declaredType) {
      case 'string':
        if (typeof value !== 'string') {
          return `Parameter "${paramName}" must be a string, got ${typeof value}.`;
        }
        // Check enum if defined
        if (propSchema.enum && Array.isArray(propSchema.enum)) {
          if (!(propSchema.enum as string[]).includes(value as string)) {
            return `Parameter "${paramName}" must be one of [${(propSchema.enum as string[]).join(', ')}], got "${value}".`;
          }
        }
        break;

      case 'number':
      case 'integer':
        if (typeof value !== 'number') {
          return `Parameter "${paramName}" must be a number, got ${typeof value}.`;
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          return `Parameter "${paramName}" must be a boolean, got ${typeof value}.`;
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          return `Parameter "${paramName}" must be an array, got ${typeof value}.`;
        }
        break;

      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          return `Parameter "${paramName}" must be an object, got ${Array.isArray(value) ? 'array' : typeof value}.`;
        }
        break;
    }

    return null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build a short summary string for the journal entry.
   */
  private buildSummary(actions: AgentAction[], finalResponse: string): string {
    if (actions.length === 0) {
      return finalResponse.slice(0, 150);
    }

    const toolNames = [...new Set(actions.map((a) => a.tool))];
    return `Used ${toolNames.join(', ')} (${actions.length} call${actions.length > 1 ? 's' : ''}) — ${finalResponse.slice(0, 100)}`;
  }
}
