import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { ApplicationRepository } from './application.repository';
import { UsersService } from '../users/users.service';
import { JobsRepository } from '../jobs/jobs.repository';
import {
  AUTO_APPLY_QUEUE,
  AUTO_APPLY_JOB,
  AutoApplyJobData,
  AutoApplyJobResult,
} from './auto-apply.types';
import { ApplicationStatus } from './application.schema';

@Injectable()
export class AutoApplyService {
  private readonly logger = new Logger(AutoApplyService.name);

  constructor(
    @InjectQueue(AUTO_APPLY_QUEUE)
    private readonly autoApplyQueue: Queue<AutoApplyJobData, AutoApplyJobResult>,
    private readonly applicationRepository: ApplicationRepository,
    private readonly usersService: UsersService,
    private readonly jobsRepository: JobsRepository,
  ) {}

  /**
   * Apply to a single job listing.
   */
  async applySingle(userId: string, jobId: string) {
    const jobDoc = await this.jobsRepository.findById(jobId);
    if (!jobDoc) throw new NotFoundException(`Job ${jobId} not found`);
    if (!jobDoc.applyUrl) {
      throw new BadRequestException(`Job ${jobId} has no apply URL`);
    }

    // Get user profile for form filling
    const profile = await this.usersService.getProfile(userId);
    const user = await this.usersService.findById(userId);

    // Create pending application record
    const existing = await this.applicationRepository.findByUserAndJob(userId, jobId);
    if (existing && existing.status === 'applied') {
      throw new BadRequestException(`Already applied to job ${jobId}`);
    }

    if (!existing) {
      await this.applicationRepository.create({
        userId,
        jobId,
        platform: this.extractPlatform(jobDoc.applyUrl),
      });
    }

    // Enqueue the auto-apply job
    const jobData: AutoApplyJobData = {
      userId,
      jobId,
      applyUrl: jobDoc.applyUrl,
      profileData: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        linkedin: profile.linkedin,
        github: profile.github,
        website: profile.website,
      },
      resumeUrl: user.resumeCloudinaryUrl,
    };

    const queueJob = await this.autoApplyQueue.add(AUTO_APPLY_JOB, jobData, {
      attempts: 1,
      removeOnComplete: { age: 60 * 60 * 24, count: 100 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    });

    this.logger.log(`Auto-apply job ${queueJob.id} enqueued for user ${userId}, job ${jobId}`);

    return { jobId: String(queueJob.id), status: 'queued' };
  }

  /**
   * Batch apply to multiple job listings (max 50).
   * Jobs are processed sequentially.
   */
  async applyBatch(userId: string, jobIds: string[]) {
    if (jobIds.length > 50) {
      throw new BadRequestException('Maximum 50 jobs per batch');
    }

    // Get user profile
    const profile = await this.usersService.getProfile(userId);
    const user = await this.usersService.findById(userId);

    // Validate all jobs have apply URLs
    const jobDocs = await this.jobsRepository.findByIds(jobIds);
    const jobMap = new Map(jobDocs.map((j) => [j._id.toString(), j]));

    const validJobs: Array<{ jobId: string; applyUrl: string }> = [];
    const skipped: Array<{ jobId: string; reason: string }> = [];

    for (const jobId of jobIds) {
      const doc = jobMap.get(jobId);
      if (!doc) {
        skipped.push({ jobId, reason: 'not_found' });
        continue;
      }
      if (!doc.applyUrl) {
        skipped.push({ jobId, reason: 'no_apply_url' });
        continue;
      }
      validJobs.push({ jobId, applyUrl: doc.applyUrl });
    }

    // Create pending applications and enqueue jobs
    const queueJobIds: string[] = [];

    for (let i = 0; i < validJobs.length; i++) {
      const { jobId, applyUrl } = validJobs[i];

      // Create pending application record
      const existing = await this.applicationRepository.findByUserAndJob(userId, jobId);
      if (!existing) {
        await this.applicationRepository.create({
          userId,
          jobId,
          platform: this.extractPlatform(applyUrl),
        });
      } else if (existing.status === 'applied') {
        skipped.push({ jobId, reason: 'already_applied' });
        continue;
      }

      const jobData: AutoApplyJobData = {
        userId,
        jobId,
        applyUrl,
        profileData: {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          linkedin: profile.linkedin,
          github: profile.github,
          website: profile.website,
        },
        resumeUrl: user.resumeCloudinaryUrl,
        batchIndex: i,
        batchTotal: validJobs.length,
      };

      const queueJob = await this.autoApplyQueue.add(AUTO_APPLY_JOB, jobData, {
        attempts: 1,
        removeOnComplete: { age: 60 * 60 * 24, count: 200 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      });

      queueJobIds.push(String(queueJob.id));
    }

    this.logger.log(
      `Batch auto-apply: ${queueJobIds.length} enqueued, ${skipped.length} skipped for user ${userId}`,
    );

    return {
      status: 'queued',
      enqueued: queueJobIds.length,
      skipped,
      queueJobIds,
    };
  }

  /**
   * Get all tracked applications for a user.
   */
  async getApplications(
    userId: string,
    options: { status?: ApplicationStatus; skip?: number; limit?: number } = {},
  ) {
    const [applications, total] = await Promise.all([
      this.applicationRepository.findByUser(userId, options),
      this.applicationRepository.countByUser(userId, options.status),
    ]);

    return { applications, total };
  }

  /**
   * Get application statistics for a user.
   */
  async getStats(userId: string) {
    return this.applicationRepository.getStats(userId);
  }

  /**
   * Get the status of an auto-apply queue job.
   */
  async getJobStatus(jobId: string) {
    const job: Job<AutoApplyJobData, AutoApplyJobResult> | undefined =
      await this.autoApplyQueue.getJob(jobId);

    if (!job) return null;

    const state = await job.getState();

    return {
      jobId: String(job.id),
      state,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
    };
  }

  private extractPlatform(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes('indeed')) return 'indeed';
      if (hostname.includes('naukri')) return 'naukri';
      if (hostname.includes('internshala')) return 'internshala';
      if (hostname.includes('linkedin')) return 'linkedin';
      return hostname.split('.').slice(-2, -1)[0] || 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
