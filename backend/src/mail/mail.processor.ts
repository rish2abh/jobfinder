import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { UsersService } from '../users/users.service';
import { MailFromService } from './mail-from.service';
import {
  MAIL_JOB,
  MAIL_QUEUE,
  BulkMailJobData,
  BulkMailJobResult,
} from './mail-job.types';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly mailFromService: MailFromService,
  ) {
    super();
  }

  async process(job: Job<BulkMailJobData, BulkMailJobResult>): Promise<BulkMailJobResult> {
    if (job.name !== MAIL_JOB) {
      throw new Error(`Unknown job name: ${job.name}`);
    }

    this.logger.log(`Processing job ${job.id} — ${job.data.mailIds.length} recipient(s)`);

    const { subject, context, mailIds, userId, from: dtoFrom, fromTtlSeconds } = job.data;

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

    // ── 3. Create transporter ─────────────────────────────────────────────
    const transporter = this.createTransporter();

    // ── 4. Send all emails (partial failure allowed) ──────────────────────
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

    const sent = results
      .map((r, i) => (r.status === 'fulfilled' ? normalisedMailIds[i] : null))
      .filter((r): r is string => r !== null);

    const failed = results
      .map((r, i) => (r.status === 'rejected' ? normalisedMailIds[i] : null))
      .filter((r): r is string => r !== null);

    // Log rejected reasons
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.warn(`Failed to send to ${normalisedMailIds[i]}: ${r.reason?.message ?? r.reason}`);
      }
    });

    if (sent.length === 0) {
      throw new Error(`All ${normalisedMailIds.length} recipients failed — job will be retried`);
    }

    this.logger.log(`Job ${job.id} complete — sent: ${sent.length}, failed: ${failed.length}`);

    return {
      message: 'Bulk mail processed',
      sent,
      failed,
      sentCount: sent.length,
      failedCount: failed.length,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

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

    const response = await axios.get<ArrayBuffer>(user.resumeCloudinaryUrl, {
      responseType: 'arraybuffer',
    });

    return {
      filename: `${user.name || 'resume'}-resume.pdf`,
      content: Buffer.from(response.data),
      contentType: 'application/pdf',
    };
  }

  private createTransporter() {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') || 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';

    if (!host || !user || !pass) {
      throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS are required');
    }

    return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  }

  private getFromAddress(): string {
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      this.configService.get<string>('SMTP_USER');

    if (!from) throw new Error('SMTP_FROM or SMTP_USER is required');
    return from;
  }
}
