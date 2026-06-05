import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { UsersService } from '../users/users.service';
import { parseResumeWithOllama } from './ollama.helper';
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

  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    logger: WinstonLoggerService,
  ) {
    super();
    this.logger = logger;
    this.ollamaUrl = this.configService.get<string>('OLLAMA_URL') ?? 'http://127.0.0.1:11434';
    this.ollamaModel = this.configService.get<string>('OLLAMA_MODEL') ?? 'mistral';
  }

  async process(
    job: Job<ResumeParseJobData, ResumeParseJobResult>,
  ): Promise<ResumeParseJobResult> {
    if (job.name !== RESUME_JOB) {
      throw new Error(`Unknown job name: ${job.name}`);
    }

    const { userId, cloudinaryUrl, cloudinaryId, rawText } = job.data;

    this.logger.log(`[Job ${job.id}] Starting LLM parse for user ${userId} — ${rawText.length} chars`, 'ResumeParse');

    try {
      // Report progress so the poller can show a live indicator
      await job.updateProgress(10);

      // ── Call Ollama with retry loop ─────────────────────────────────────
      const { parsedJson, llmAttempts } = await parseResumeWithOllama(rawText, this.ollamaUrl, this.ollamaModel);

      await job.updateProgress(80);

      // ── Persist to MongoDB ──────────────────────────────────────────────
      this.logger.log(`[Job ${job.id}] LLM done (${llmAttempts} attempt(s)) — saving to DB`, 'ResumeParse');

      await this.usersService.saveResume(userId, {
        parsedJson,
        rawText,
        cloudinaryUrl,
        cloudinaryId,
      });

      await job.updateProgress(100);

      this.logger.log(`[Job ${job.id}] Complete for user ${userId}`, 'ResumeParse');

      return {
        userId,
        cloudinaryUrl,
        rawText,
        parsedJson,
        llmAttempts,
      };
    } catch (err) {
      this.logger.error(`[Job ${job.id}] Error processing resume for user ${userId}`, err?.stack || String(err), 'ResumeParse');
      throw err;
    }
  }
}
