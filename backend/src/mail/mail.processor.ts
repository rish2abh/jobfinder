import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Job } from 'bullmq';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { UsersService } from '../users/users.service';
import { MailFromService } from './mail-from.service';
import { MailResult, MailResultDocument } from './mail-result.schema';
import { WinstonLoggerService } from '../logger/winston-logger.service';
import {
  MAIL_JOB,
  MAIL_QUEUE,
  TEMPLATE_MAIL_JOB,
  BulkMailJobData,
  BulkMailJobResult,
  TemplateMailJobData,
  TemplateMailJobResult,
} from './mail-job.types';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly context = 'MailProcessor';
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly mailFromService: MailFromService,
    @InjectModel(MailResult.name)
    private readonly mailResultModel: Model<MailResultDocument>,
    private readonly logger: WinstonLoggerService,
  ) {
    super();
  }

  /**
   * Get or create a reusable SMTP transporter with connection pooling.
   * This avoids creating a new TCP/TLS connection for every single email.
   */
  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') || 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS are required');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      pool: true, // Enable connection pooling
      maxConnections: 3, // Limit concurrent SMTP connections
      maxMessages: 50, // Recycle connection after N messages
      rateLimit: 5, // Max 5 messages/second per connection
    });

    return this.transporter;
  }

  async process(
    job: Job<
      BulkMailJobData | TemplateMailJobData,
      BulkMailJobResult | TemplateMailJobResult
    >,
  ): Promise<BulkMailJobResult | TemplateMailJobResult> {
    const userId = (job.data as any).userId;

    this.logger.info('Job started', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: MAIL_QUEUE,
      jobName: job.name,
    });

    const startTime = Date.now();

    try {
      let result: BulkMailJobResult | TemplateMailJobResult;

      if (job.name === TEMPLATE_MAIL_JOB) {
        result = await this.processTemplateEmail(
          job as Job<TemplateMailJobData, TemplateMailJobResult>,
        );
      } else if (job.name === MAIL_JOB) {
        result = await this.processBulkMail(
          job as Job<BulkMailJobData, BulkMailJobResult>,
        );
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }

      const durationMs = Date.now() - startTime;
      this.logger.info('Job completed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MAIL_QUEUE,
        durationMs,
      });

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.logger.errorWithMeta('Job failed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MAIL_QUEUE,
        durationMs,
        trace: err?.stack || String(err),
      });
      throw err;
    }
  }

  // ── Template email handler (one recipient per job) ────────────────────

  private async processTemplateEmail(
    job: Job<TemplateMailJobData, TemplateMailJobResult>,
  ): Promise<TemplateMailJobResult> {
    const {
      userId,
      bulkJobId,
      groupId,
      recipientEmail,
      recipientName,
      subject,
      body,
      from: jobFrom,
      resumeUrl,
    } = job.data;

    this.logger.info('Job progress: sending template email', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: MAIL_QUEUE,
      recipientEmail,
    });

    const startTime = Date.now();
    try {
      // Resolve sender address
      const from = await this.resolveSenderAddress(jobFrom);

      // Create transporter (pooled)
      const transporter = this.getTransporter();

      // Build attachment from Cloudinary URL or user's base resume.
      // Attachment failure is non-fatal — we still send the email without it.
      let attachment: {
        filename: string;
        content: Buffer;
        contentType: string;
      } | null = null;
      try {
        attachment = await this.resolveTemplateAttachment(userId, resumeUrl);
      } catch (attachErr: any) {
        this.logger.warn(
          `[SMTP] Attachment fetch failed for ${recipientEmail}, sending without attachment: ${attachErr.message}`,
          this.context,
        );
      }

      // Send the email
      await transporter.sendMail({
        from,
        to: recipientEmail.trim().toLowerCase(),
        subject,
        html: body,
        attachments: attachment ? [attachment] : [],
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[SMTP] sendMail — success — elapsed: ${elapsed}ms, to: ${recipientEmail}`,
        this.context,
      );

      // Store success result
      await this.storeMailResult({
        userId,
        bulkJobId,
        groupId,
        recipientEmail,
        recipientName,
        status: 'sent',
        sentAt: new Date(),
      });

      return {
        recipientEmail,
        status: 'sent',
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const failureReason = error?.message || 'Unknown error';

      this.logger.error(
        `[SMTP] sendMail — failed — elapsed: ${elapsed}ms, to: ${recipientEmail}, error: ${failureReason}`,
        error?.stack,
        this.context,
      );

      // Store failure result
      await this.storeMailResult({
        userId,
        bulkJobId,
        groupId,
        recipientEmail,
        recipientName,
        status: 'failed',
        failureReason,
      });

      return {
        recipientEmail,
        status: 'failed',
        failureReason,
      };
    }
  }

  // ── Legacy bulk mail handler ──────────────────────────────────────────

  private async processBulkMail(
    job: Job<BulkMailJobData, BulkMailJobResult>,
  ): Promise<BulkMailJobResult> {
    const {
      subject,
      context,
      mailIds,
      userId,
      from: dtoFrom,
      fromTtlSeconds,
    } = job.data;

    this.logger.info(
      `Job progress: processing bulk mail for ${mailIds.length} recipient(s)`,
      {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MAIL_QUEUE,
        recipientCount: mailIds.length,
      },
    );

    // Normalise recipient emails to lowercase — some SMTP servers reject mixed-case
    const normalisedMailIds = mailIds.map((m) => m.trim().toLowerCase());

    // ── 1. Resolve attachment ─────────────────────────────────────────────
    const attachment = await this.resolveAttachment(job.data);

    // ── 2. Resolve sender address ─────────────────────────────────────────
    let from: string;
    if (dtoFrom) {
      const ttl = Number(fromTtlSeconds || 0);
      const entry = await this.mailFromService.createOrUpdate(
        dtoFrom,
        ttl > 0 ? ttl : 7 * 24 * 3600,
        'active',
      );
      from = entry.address;
    } else {
      const active = await this.mailFromService.findActive();
      from = active?.address ?? this.getFromAddress();
    }

    // ── 3. Create transporter (pooled) ───────────────────────────────────────
    const transporter = this.getTransporter();

    // ── 4. Send all emails (partial failure allowed) ──────────────────────
    const sendStartTime = Date.now();
    const results = await Promise.allSettled(
      normalisedMailIds.map((recipient) =>
        transporter.sendMail({
          from,
          to: recipient,
          subject,
          text: context,
          attachments: [attachment],
        }),
      ),
    );
    const sendElapsed = Date.now() - sendStartTime;

    const sent = results
      .map((r, i) => (r.status === 'fulfilled' ? normalisedMailIds[i] : null))
      .filter((r): r is string => r !== null);

    const failed = results
      .map((r, i) => (r.status === 'rejected' ? normalisedMailIds[i] : null))
      .filter((r): r is string => r !== null);

    // Log rejected reasons
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.error(
          `[SMTP] sendMail — failed — to: ${normalisedMailIds[i]}, error: ${r.reason?.message ?? r.reason}`,
          r.reason?.stack,
          this.context,
        );
      }
    });

    if (sent.length === 0) {
      this.logger.error(
        `[SMTP] bulkMail — all failed — elapsed: ${sendElapsed}ms, recipients: ${normalisedMailIds.length}`,
        undefined,
        this.context,
      );
      throw new Error(
        `All ${normalisedMailIds.length} recipients failed — job will be retried`,
      );
    }

    this.logger.info(
      `[SMTP] bulkMail — complete — elapsed: ${sendElapsed}ms, sent: ${sent.length}, failed: ${failed.length}`,
      {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MAIL_QUEUE,
      },
    );

    return {
      message: 'Bulk mail processed',
      sent,
      failed,
      sentCount: sent.length,
      failedCount: failed.length,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async resolveSenderAddress(jobFrom?: string): Promise<string> {
    if (jobFrom) {
      return jobFrom;
    }
    const active = await this.mailFromService.findActive();
    return active?.address ?? this.getFromAddress();
  }

  private async resolveTemplateAttachment(
    userId: string,
    resumeUrl?: string,
  ): Promise<{
    filename: string;
    content: Buffer;
    contentType: string;
  } | null> {
    // Use provided URL (customized resume) or fall back to user's base resume
    const url = resumeUrl || (await this.getUserResumeUrl(userId));

    if (!url) {
      return null;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[Cloudinary] fetchAttachment — success — elapsed: ${elapsed}ms, status: ${response.status}`,
        this.context,
      );

      const user = await this.usersService.findById(userId);
      const filename = `${user?.name || 'resume'}-resume.pdf`;

      return {
        filename,
        content: Buffer.from(response.data),
        contentType: 'application/pdf',
      };
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      this.logger.error(
        `[Cloudinary] fetchAttachment — failed — elapsed: ${elapsed}ms` +
          `${status ? `, status: ${status}` : ''}, error: ${err.message}`,
        err.stack,
        this.context,
      );
      throw err;
    }
  }

  private async getUserResumeUrl(userId: string): Promise<string | null> {
    const user = await this.usersService.findById(userId);
    return user?.resumeCloudinaryUrl || null;
  }

  private async storeMailResult(data: {
    userId: string;
    bulkJobId: string;
    groupId: string;
    recipientEmail: string;
    recipientName: string;
    status: 'sent' | 'failed';
    failureReason?: string;
    sentAt?: Date;
  }): Promise<void> {
    try {
      await this.mailResultModel.create({
        userId: new Types.ObjectId(data.userId),
        bulkJobId: data.bulkJobId,
        groupId: new Types.ObjectId(data.groupId),
        recipientEmail: data.recipientEmail,
        recipientName: data.recipientName,
        status: data.status,
        failureReason: data.failureReason,
        sentAt: data.sentAt,
      });
    } catch (err) {
      this.logger.error(
        `Failed to store mail result for ${data.recipientEmail}: ${err?.message}`,
        undefined,
        this.context,
      );
    }
  }

  private async resolveAttachment(data: BulkMailJobData) {
    // Case 1: file was uploaded with the request
    if (data.resumeBase64) {
      return {
        filename: data.resumeFilename || 'resume.pdf',
        content: Buffer.from(data.resumeBase64, 'base64'),
        contentType: data.resumeMimetype || 'application/pdf',
      };
    }

    // Case 2: fetch from Cloudinary using userId
    const user = await this.usersService.findById(data.userId!);
    if (!user.resumeCloudinaryUrl) {
      throw new Error('No uploaded resume found for this user');
    }

    const startTime = Date.now();
    try {
      const response = await axios.get<ArrayBuffer>(user.resumeCloudinaryUrl, {
        responseType: 'arraybuffer',
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[Cloudinary] fetchResume — success — elapsed: ${elapsed}ms, status: ${response.status}`,
        this.context,
      );

      return {
        filename: `${user.name || 'resume'}-resume.pdf`,
        content: Buffer.from(response.data),
        contentType: 'application/pdf',
      };
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      this.logger.error(
        `[Cloudinary] fetchResume — failed — elapsed: ${elapsed}ms` +
          `${status ? `, status: ${status}` : ''}, error: ${err.message}`,
        err.stack,
        this.context,
      );
      throw err;
    }
  }

  private createTransporter() {
    // Kept as fallback for cases that need a fresh, non-pooled connection
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') || 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS are required');
    }

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  private getFromAddress(): string {
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      this.configService.get<string>('SMTP_USER');

    if (!from) throw new Error('SMTP_FROM or SMTP_USER is required');
    return from;
  }
}
