import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import pdfParse = require('pdf-parse');
import { UsersService } from '../users/users.service';
import { WinstonLoggerService } from '../logger/winston-logger.service';
import {
  RESUME_JOB,
  RESUME_QUEUE,
  ResumeParseJobData,
  ResumeParseJobResult,
} from './resume-job.types';

@Injectable()
export class FileUploadService {
  private readonly uploadFolder: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @InjectQueue(RESUME_QUEUE)
    private readonly resumeQueue: Queue<ResumeParseJobData, ResumeParseJobResult>,
    private readonly logger: WinstonLoggerService,
  ) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey    = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.error('Cloudinary credentials are missing');
      throw new Error('Cloudinary credentials are required via environment variables');
    }

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

    this.uploadFolder = this.configService.get<string>('CLOUDINARY_UPLOAD_FOLDER') ?? 'jobfinder/resumes';
  }

  // ── POST /uploads/resume ─────────────────────────────────────────────────

  /**
   * Fast path (synchronous):
   *   1. Upload PDF to Cloudinary          (~1-3 s)
   *   2. Extract raw text with pdf-parse   (<1 s)
   * Then immediately enqueue the slow LLM job and return { jobId } to the client.
   */
  async uploadResume(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{ jobId: string; status: 'queued'; cloudinaryUrl: string }> {
    // Verify user exists before doing any work
    await this.usersService.findById(userId);

    // Step 1 — Upload to Cloudinary
    this.logger.log(`Uploading PDF to Cloudinary for user ${userId}`);
    let uploaded;
    try {
      uploaded = await this.uploadFileToCloudinary(file);
      this.logger.log(`Cloudinary upload successful for user ${userId}: ${uploaded.secure_url}`);
    } catch (err) {
      this.logger.error(`Cloudinary upload failed for user ${userId}`, err?.stack || String(err));
      throw err;
    }

    // Step 2 — Extract raw text (fast, in-memory)
    this.logger.log(`Extracting text from PDF for user ${userId}`);
    let rawText: string;
    try {
      rawText = await this.extractTextFromPdf(file.buffer);
      this.logger.log(`Text extraction complete for user ${userId} (length=${rawText.length})`);
    } catch (err) {
      this.logger.error(`Text extraction failed for user ${userId}`, err?.stack || String(err));
      throw err;
    }

    // Step 3 — Enqueue the LLM parsing job
    const jobData: ResumeParseJobData = {
      userId,
      cloudinaryUrl: uploaded.secure_url,
      cloudinaryId: uploaded.public_id,
      rawText,
      // Store PDF as base64 so the job can be fully replayed if needed
      pdfBase64: file.buffer.toString('base64'),
    };

    this.logger.log(`Enqueuing resume parse job for user ${userId}`);
    let job: Job<ResumeParseJobData, ResumeParseJobResult>;
    try {
      job = await this.resumeQueue.add(RESUME_JOB, jobData, {
      attempts: 2,                         // retry the whole job once if the processor crashes
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 200 },
      removeOnFail:     { age: 60 * 60 * 24 * 7 },
      });
      this.logger.log(`Resume parse job ${job.id} enqueued for user ${userId}`);
    } catch (err) {
      this.logger.error(`Failed to enqueue resume parse job for user ${userId}`, err?.stack || String(err));
      throw new InternalServerErrorException('Unable to enqueue resume parse job');
    }

    return {
      jobId: String(job.id),
      status: 'queued',
      cloudinaryUrl: uploaded.secure_url,
    };
  }

  // ── GET /uploads/resume/status/:jobId ────────────────────────────────────

  async getParseJobStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    progress: number;
    result: ResumeParseJobResult | null;
    failedReason: string | null;
    attemptsMade: number;
  }> {
    const job: Job<ResumeParseJobData, ResumeParseJobResult> | undefined =
      await this.resumeQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Parse job ${jobId} not found`);
    }

    const state       = await job.getState();
    const returnValue = job.returnvalue ?? null;

    return {
      jobId: String(job.id),
      state,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      result: returnValue,
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
    };
  }

  // ── POST /uploads/resume/reparse ─────────────────────────────────────────

  /**
   * Re-triggers LLM parsing using the already-stored rawText — no re-upload needed.
   */
  async reparseResume(userId: string): Promise<{ jobId: string; status: 'queued' }> {
    const user = await this.usersService.findById(userId);

    if (!user.resumeRawText) {
      throw new NotFoundException('No raw text stored for this user — please re-upload the PDF');
    }

    if (!user.resumeCloudinaryUrl) {
      throw new NotFoundException('No resume on file — please upload a PDF first');
    }

    const jobData: ResumeParseJobData = {
      userId,
      cloudinaryUrl: user.resumeCloudinaryUrl,
      cloudinaryId:  user.resumeCloudinaryId ?? '',
      rawText:       user.resumeRawText,
      // No pdfBase64 needed — we already have rawText
    };

    this.logger.log(`Enqueuing re-parse job for user ${userId}`);
    const job = await this.resumeQueue.add(RESUME_JOB, jobData, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 200 },
      removeOnFail:     { age: 60 * 60 * 24 * 7 },
    });

    this.logger.log(`Re-parse job ${job.id} enqueued for user ${userId}`);

    return { jobId: String(job.id), status: 'queued' };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async uploadFileToCloudinary(file: Express.Multer.File) {
    return new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: this.uploadFolder,
          // 'raw' ensures PDFs aren't treated as images — critical for
          // serving them back as application/pdf with correct headers.
          resource_type: 'raw',
          // fl_attachment:false tells Cloudinary to set
          // Content-Disposition: inline so the browser displays the PDF
          // inside an <iframe> instead of triggering a file download.
          flags: 'attachment:false',
        },
        (error, result) => {
          if (error) {
            this.logger.error('Cloudinary uploader callback error', error?.stack || String(error));
            return reject(new InternalServerErrorException(`Cloudinary upload failed: ${error.message}`));
          }
          if (!result) {
            this.logger.error('Cloudinary uploader returned no result');
            return reject(new InternalServerErrorException('Cloudinary upload returned no result'));
          }
          this.logger.log(`Cloudinary upload callback OK: ${result.secure_url}`);
          resolve(result as { secure_url: string; public_id: string });
        },
      );
      stream.end(file.buffer);
    });
  }

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text?.trim() ?? '';
    } catch (err) {
      this.logger.error('pdf-parse failed', err?.stack || String(err));
      throw new InternalServerErrorException('Unable to extract text from the uploaded PDF');
    }
  }
}
