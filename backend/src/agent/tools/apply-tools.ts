import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentTool } from './tool-registry';
import { GeminiFunctionDeclaration } from '../gemini-client.service';
import { AutoApplyService } from '../../auto-apply/auto-apply.service';
import { ApplicationRepository } from '../../auto-apply/application.repository';
import { MatchingService } from '../../matching/matching.service';

/**
 * Wraps AutoApplyService with guardrails:
 * - Minimum match score threshold (configurable via AGENT_AUTO_APPLY_MIN_SCORE)
 * - Daily application cap (configurable via AGENT_AUTO_APPLY_DAILY_CAP)
 * - Duplicate prevention (applySingle already throws if user already applied)
 *
 * Since this executes inside AgentProcessor (BullMQ worker), polling for
 * completion of the queued apply job is safe and expected.
 */
@Injectable()
export class ApplyTools implements AgentTool {
  private readonly logger = new Logger(ApplyTools.name);
  readonly name = 'auto_apply';

  readonly declaration: GeminiFunctionDeclaration = {
    name: 'auto_apply',
    description:
      'Automatically apply to job listings using Playwright form-filling. ' +
      'IMPORTANT: Requires explicit user confirmation. The agent should always ' +
      'present the job details and match score before calling this tool. ' +
      'Enforces a minimum match score threshold and a daily application cap.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['apply_single', 'apply_batch', 'check_status', 'get_stats'],
          description: 'What to do',
        },
        jobId: {
          type: 'string',
          description: 'Job MongoDB ID (apply_single)',
        },
        jobIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of job IDs (apply_batch, max 50)',
        },
        statusJobId: {
          type: 'string',
          description: 'BullMQ job ID to check (check_status)',
        },
      },
      required: ['action'],
    },
  };

  private readonly minScore: number;
  private readonly dailyCap: number;

  constructor(
    private readonly autoApplyService: AutoApplyService,
    private readonly applicationRepository: ApplicationRepository,
    private readonly matchingService: MatchingService,
    private readonly configService: ConfigService,
  ) {
    this.minScore = parseFloat(
      this.configService.get<string>('AGENT_AUTO_APPLY_MIN_SCORE', '0.8'),
    ) * 100; // stored as 0-1 in env, scores are 0-100
    this.dailyCap = parseInt(
      this.configService.get<string>('AGENT_AUTO_APPLY_DAILY_CAP', '20'),
      10,
    );
  }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId as string;
    const action = args.action as string;

    switch (action) {
      case 'apply_single':
        return this.applySingle(userId, args.jobId as string);

      case 'apply_batch':
        return this.applyBatch(userId, args.jobIds as string[]);

      case 'check_status': {
        const statusJobId = args.statusJobId as string;
        if (!statusJobId) return { error: 'statusJobId is required' };
        const status = await this.autoApplyService.getJobStatus(statusJobId);
        return status ?? { error: `Job ${statusJobId} not found` };
      }

      case 'get_stats':
        return this.autoApplyService.getStats(userId);

      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  // ── Single apply with guardrails + polling ─────────────────────────────────

  private async applySingle(userId: string, jobId: string) {
    if (!jobId) return { error: 'jobId is required for apply_single' };

    // Guardrail 1: daily cap
    const capCheck = await this.checkDailyCap(userId);
    if (capCheck.blocked) return capCheck;

    // Guardrail 2: check match score
    const scoreCheck = await this.checkScoreThreshold(userId, [jobId]);
    if (scoreCheck.belowThreshold.length > 0) {
      return {
        blocked: true,
        reason: `Match score (${scoreCheck.belowThreshold[0].score}%) is below minimum threshold (${this.minScore}%). ` +
          'Ask the user if they still want to apply despite the low score.',
        threshold: this.minScore,
        jobId,
      };
    }

    // Enqueue the apply job — catch BadRequestException (already-applied / no apply URL)
    let enqueueResult: { jobId: string; status: string };
    try {
      enqueueResult = await this.autoApplyService.applySingle(userId, jobId);
    } catch (err) {
      if (err instanceof BadRequestException) {
        return { status: 'skipped', reason: err.message, jobId };
      }
      throw err;
    }

    const queueJobId = enqueueResult.jobId;
    this.logger.log(`Polling auto-apply job ${queueJobId} for user ${userId}, job ${jobId}`);

    // Poll until the apply job completes (safe — we're inside a BullMQ worker)
    const result = await this.pollApplyJob(queueJobId);
    return { ...(result as Record<string, unknown>), jobId };
  }

  // ── Batch apply with guardrails ────────────────────────────────────────────

  private async applyBatch(userId: string, jobIds: string[]) {
    if (!jobIds?.length) return { error: 'jobIds array is required for apply_batch' };

    // Guardrail 1: daily cap (check remaining capacity)
    const capCheck = await this.checkDailyCap(userId, jobIds.length);
    if (capCheck.blocked) return capCheck;

    // Guardrail 2: check scores for all jobs
    const scoreCheck = await this.checkScoreThreshold(userId, jobIds);
    if (scoreCheck.belowThreshold.length > 0) {
      return {
        blocked: true,
        reason: `${scoreCheck.belowThreshold.length} jobs are below the minimum score threshold (${this.minScore}%).`,
        belowThreshold: scoreCheck.belowThreshold,
        aboveThreshold: scoreCheck.aboveThreshold,
        suggestion: 'Remove low-scoring jobs or ask the user to confirm.',
      };
    }

    return this.autoApplyService.applyBatch(userId, jobIds);
  }

  // ── Guardrail: daily cap ───────────────────────────────────────────────────

  private async checkDailyCap(userId: string, requestedCount = 1) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayCount = await this.applicationRepository.countByUserSince(userId, startOfDay);

    if (todayCount + requestedCount > this.dailyCap) {
      return {
        blocked: true,
        reason: `Daily application cap reached. ` +
          `Applied today: ${todayCount}/${this.dailyCap}. ` +
          `Requested: ${requestedCount}. ` +
          'Try again tomorrow or ask the user to adjust the cap.',
        todayCount,
        dailyCap: this.dailyCap,
      };
    }

    return { blocked: false, todayCount, remaining: this.dailyCap - todayCount };
  }

  // ── Guardrail: score threshold ─────────────────────────────────────────────

  private async checkScoreThreshold(userId: string, jobIds: string[]) {
    const { scores } = await this.matchingService.getScores(userId, { limit: 200 });
    const scoreMap = new Map(
      scores.map((s: any) => [s.jobId?.toString(), s.finalScore]),
    );

    const belowThreshold: Array<{ jobId: string; score: number }> = [];
    const aboveThreshold: Array<{ jobId: string; score: number }> = [];

    for (const jobId of jobIds) {
      const score = scoreMap.get(jobId) ?? 0;
      if (score < this.minScore) {
        belowThreshold.push({ jobId, score });
      } else {
        aboveThreshold.push({ jobId, score });
      }
    }

    return { belowThreshold, aboveThreshold };
  }

  // ── Poll apply job to completion ───────────────────────────────────────────

  private async pollApplyJob(queueJobId: string, maxWaitMs = 90_000): Promise<unknown> {
    const startTime = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.autoApplyService.getJobStatus(queueJobId);

      if (!status) {
        return { status: 'not_found', queueJobId };
      }

      if (status.state === 'completed') {
        return {
          status: 'completed',
          queueJobId,
          result: status.result,
        };
      }

      if (status.state === 'failed') {
        return {
          status: 'failed',
          queueJobId,
          failedReason: status.failedReason,
        };
      }

      await this.sleep(pollIntervalMs);
    }

    return {
      status: 'timeout',
      queueJobId,
      message: `Auto-apply job did not complete within ${maxWaitMs / 1000}s. It is still processing.`,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
