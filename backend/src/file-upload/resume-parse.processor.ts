import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { UsersService } from '../users/users.service';
import { MatchingService } from '../matching/matching.service';
import { parseResumeWithOllama } from './ollama.helper';
import { parseResumeWithClaude } from './claude.helper';
import { parseResumeWithGroq } from './groq.helper';
import { parseResumeWithLlamaParse } from './llamaparse.helper';
import { WinstonLoggerService } from '../logger/winston-logger.service';
import {
  RESUME_JOB,
  RESUME_QUEUE,
  ResumeParseJobData,
  ResumeParseJobResult,
} from './resume-job.types';

@Processor(RESUME_QUEUE)
export class ResumeParseProcessor extends WorkerHost {
  private readonly logger: WinstonLoggerService;
  private readonly context = 'ResumeParseProcessor';

  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;
  private readonly claudeApiKey: string;
  private readonly claudeModel: string;
  private readonly groqApiKey: string;
  private readonly groqModel: string;
  private readonly llamaparseApiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => MatchingService))
    private readonly matchingService: MatchingService,
    logger: WinstonLoggerService,
  ) {
    super();
    this.logger = logger;
    this.ollamaUrl = this.configService.get<string>('OLLAMA_URL') ?? 'http://127.0.0.1:11434';
    this.ollamaModel = this.configService.get<string>('OLLAMA_MODEL') ?? 'mistral';
    this.claudeApiKey = this.configService.get<string>('CLAUDE_API_KEY') ?? '';
    this.claudeModel = this.configService.get<string>('CLAUDE_MODEL') ?? 'claude-sonnet-4-20250514';
    this.groqApiKey = this.configService.get<string>('GROQ_API_KEY') ?? '';
    this.groqModel = this.configService.get<string>('GROQ_MODEL') ?? 'llama-3.3-70b-versatile';
    this.llamaparseApiKey = this.configService.get<string>('LLAMAPARSE_API_KEY') ?? '';
  }

  async process(
    job: Job<ResumeParseJobData, ResumeParseJobResult>,
  ): Promise<ResumeParseJobResult> {
    if (job.name !== RESUME_JOB) {
      throw new Error(`Unknown job name: ${job.name}`);
    }

    const { userId, cloudinaryUrl, cloudinaryId, rawText, provider } = job.data;
    const startTime = Date.now();
    const selectedProvider = provider || 'groq';

    this.logger.info('Job started', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: RESUME_QUEUE,
      provider: selectedProvider,
    });

    try {
      // Report progress so the poller can show a live indicator
      await job.updateProgress(10);
      this.logger.info(`Job progress: LLM call started (provider: ${selectedProvider})`, {
        context: this.context,
        jobId: job.id,
        userId,
        queue: RESUME_QUEUE,
        textLength: rawText.length,
        provider: selectedProvider,
      });

      // ── Call LLM based on selected provider ─────────────────────────────
      let parsedJson: Record<string, unknown>;
      let llmAttempts: number;

      if (selectedProvider === 'groq') {
        if (!this.groqApiKey) {
          throw new Error('GROQ_API_KEY environment variable is not configured');
        }
        const result = await parseResumeWithGroq(rawText, this.groqApiKey, this.groqModel);
        parsedJson = result.parsedJson;
        llmAttempts = result.llmAttempts;
      } else if (selectedProvider === 'claude') {
        if (!this.claudeApiKey) {
          throw new Error('CLAUDE_API_KEY environment variable is not configured');
        }
        const result = await parseResumeWithClaude(rawText, this.claudeApiKey, this.claudeModel);
        parsedJson = result.parsedJson;
        llmAttempts = result.llmAttempts;
      } else if (selectedProvider === 'llamaparse') {
        if (!this.llamaparseApiKey) {
          throw new Error('LLAMAPARSE_API_KEY environment variable is not configured');
        }
        const result = await parseResumeWithLlamaParse(rawText, job.data.pdfBase64, this.llamaparseApiKey);
        parsedJson = result.parsedJson;
        llmAttempts = result.llmAttempts;
      } else {
        const result = await parseResumeWithOllama(rawText, this.ollamaUrl, this.ollamaModel);
        parsedJson = result.parsedJson;
        llmAttempts = result.llmAttempts;
      }

      await job.updateProgress(80);
      this.logger.info('Job progress: LLM response received, saving to DB', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: RESUME_QUEUE,
        llmAttempts,
      });

      // ── Persist to MongoDB ──────────────────────────────────────────────
      await this.usersService.saveResume(userId, {
        parsedJson,
        rawText,
        cloudinaryUrl,
        cloudinaryId,
      });

      await job.updateProgress(100);

      const durationMs = Date.now() - startTime;
      this.logger.info('Job completed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: RESUME_QUEUE,
        durationMs,
      });

      // ── Trigger matching: embed user's profile for scoring ──────────────
      try {
        await this.matchingService.onProfileUpdate(userId);
        this.logger.info('Matching profile embed enqueued', {
          context: this.context,
          jobId: job.id,
          userId,
          queue: RESUME_QUEUE,
        });
      } catch (matchErr: any) {
        // Non-blocking — don't fail the parse job if matching enqueue fails
        this.logger.warn(
          `Failed to enqueue matching for user ${userId}: ${matchErr?.message}`,
          this.context,
        );
      }

      return {
        userId,
        cloudinaryUrl,
        rawText,
        parsedJson,
        llmAttempts,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.logger.errorWithMeta('Job failed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: RESUME_QUEUE,
        durationMs,
        trace: err?.stack || String(err),
      });
      throw err;
    }
  }
}
