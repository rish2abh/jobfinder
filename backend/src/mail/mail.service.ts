import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { SendBulkMailDto } from './dto/send-bulk-mail.dto';
import {
  MAIL_JOB,
  MAIL_QUEUE,
  BulkMailJobData,
  BulkMailJobResult,
} from './mail-job.types';

@Injectable()
export class MailService {
  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<BulkMailJobData, BulkMailJobResult>,
  ) {}

  /**
   * Enqueues a bulk-mail job and returns immediately.
   * The job is processed asynchronously by MailProcessor.
   */
  async enqueueBulkMail(
    dto: SendBulkMailDto,
    resume?: Express.Multer.File,
  ): Promise<{ jobId: string; status: 'queued' }> {
    const jobData: BulkMailJobData = {
      subject: dto.subject,
      context: dto.context,
      mailIds: dto.mailIds,
      userId: dto.userId,
      from: dto.from,
      fromTtlSeconds: dto.fromTtlSeconds,
    };

    // Serialise the file buffer to base64 so it can be stored in Redis
    if (resume?.buffer) {
      jobData.resumeBase64 = resume.buffer.toString('base64');
      jobData.resumeFilename = resume.originalname || 'resume.pdf';
      jobData.resumeMimetype = resume.mimetype || 'application/pdf';
    }

    const job = await this.mailQueue.add(MAIL_JOB, jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000, // 5 s → 10 s → 20 s
      },
      removeOnComplete: {
        age: 60 * 60 * 24, // keep completed jobs for 24 hours
        count: 500,
      },
      removeOnFail: {
        age: 60 * 60 * 24 * 7, // keep failed jobs for 7 days
      },
    });

    return { jobId: String(job.id), status: 'queued' };
  }

  /**
   * Returns the current state + result of a queued job.
   */
  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    progress: number | object;
    result: BulkMailJobResult | null;
    failedReason: string | null;
    attemptsMade: number;
    timestamp: number;
  }> {
    const job: Job<BulkMailJobData, BulkMailJobResult> | undefined =
      await this.mailQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const state = await job.getState();
    const returnValue = job.returnvalue ?? null;
    const failedReason = job.failedReason ?? null;

    return {
      jobId: String(job.id),
      state,
      progress: job.progress as number | object,
      result: returnValue,
      failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    };
  }

  /**
   * Returns all bulk-mail jobs for a given userId, across all states.
   * BullMQ stores jobs in Redis — we pull completed + failed + active + waiting.
   */
  async getJobsForUser(userId: string): Promise<Array<{
    jobId: string;
    state: string;
    subject: string;
    recipientCount: number;
    sentCount: number;
    failedCount: number;
    timestamp: number;
    result: BulkMailJobResult | null;
    failedReason: string | null;
  }>> {
    // Fetch jobs from all states that BullMQ keeps in Redis
    const [completed, failed, active, waiting, delayed] = await Promise.all([
      this.mailQueue.getCompleted(0, 100),
      this.mailQueue.getFailed(0, 100),
      this.mailQueue.getActive(0, 50),
      this.mailQueue.getWaiting(0, 50),
      this.mailQueue.getDelayed(0, 50),
    ]);

    const allJobs = [...completed, ...failed, ...active, ...waiting, ...delayed];

    // Filter by userId
    const userJobs = allJobs.filter((j) => j.data?.userId === userId);

    // Deduplicate by job id (a job could appear in multiple lists during transitions)
    const seen = new Set<string>();
    const deduplicated = userJobs.filter((j) => {
      const id = String(j.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Build response in parallel
    const results = await Promise.all(
      deduplicated.map(async (job) => {
        const state = await job.getState();
        const result = job.returnvalue ?? null;
        return {
          jobId: String(job.id),
          state,
          subject: job.data.subject ?? '',
          recipientCount: job.data.mailIds?.length ?? 0,
          sentCount: result?.sentCount ?? result?.sent?.length ?? 0,
          failedCount: result?.failedCount ?? result?.failed?.length ?? 0,
          timestamp: job.timestamp,
          result,
          failedReason: job.failedReason ?? null,
        };
      }),
    );

    // Most recent first
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Returns aggregate mail stats for a given userId.
   */
  async getStatsForUser(userId: string): Promise<{
    totalJobs: number;
    totalSent: number;
    totalFailed: number;
    totalRecipients: number;
    completedJobs: number;
    failedJobs: number;
    pendingJobs: number;
  }> {
    const jobs = await this.getJobsForUser(userId);

    const totalSent = jobs.reduce((s, j) => s + j.sentCount, 0);
    const totalFailed = jobs.reduce((s, j) => s + j.failedCount, 0);
    const totalRecipients = jobs.reduce((s, j) => s + j.recipientCount, 0);
    const completedJobs = jobs.filter((j) => j.state === 'completed').length;
    const failedJobs = jobs.filter((j) => j.state === 'failed').length;
    const pendingJobs = jobs.filter(
      (j) => j.state === 'waiting' || j.state === 'active' || j.state === 'delayed',
    ).length;

    return {
      totalJobs: jobs.length,
      totalSent,
      totalFailed,
      totalRecipients,
      completedJobs,
      failedJobs,
      pendingJobs,
    };
  }
}
