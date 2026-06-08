import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { MatchScoreRepository } from './match-score.repository';
import { EmbeddingService } from './embedding.service';
import {
  MATCHING_QUEUE,
  MATCHING_JOBS,
  MatchingJobData,
  MatchingJobResult,
} from './matching.types';

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectQueue(MATCHING_QUEUE)
    private readonly matchingQueue: Queue<MatchingJobData, MatchingJobResult>,
    private readonly matchScoreRepository: MatchScoreRepository,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Return cached match scores for a user, paginated and sorted by score descending.
   */
  async getScores(
    userId: string,
    pagination: { skip?: number; limit?: number } = {},
  ) {
    const skip = pagination.skip ?? 0;
    const limit = pagination.limit ?? 50;

    const [scores, total] = await Promise.all([
      this.matchScoreRepository.findByUser(userId, {
        skip,
        limit,
        sort: { finalScore: -1 },
      }),
      this.matchScoreRepository.countByUser(userId),
    ]);

    return { scores, total, skip, limit };
  }

  /**
   * Force recompute all scores for a user.
   * Invalidates existing cache and enqueues a compute-scores job.
   */
  async recompute(userId: string) {
    const invalidated = await this.matchScoreRepository.invalidateByUser(userId);
    this.logger.log(
      `Invalidated ${invalidated} cached scores for user ${userId} — enqueuing recompute`,
    );

    const job = await this.matchingQueue.add(
      MATCHING_JOBS.COMPUTE_SCORES,
      { type: 'compute-scores', userId, jobIds: [] },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 50 },
        removeOnFail: { age: 60 * 60 * 24 * 3 },
      },
    );

    return { jobId: String(job.id), status: 'queued', invalidated };
  }

  /**
   * Called when a user's profile is updated.
   * Deletes profile embedding, invalidates scores, re-embeds profile, then recomputes.
   */
  async onProfileUpdate(userId: string) {
    // Delete existing profile embedding from ChromaDB
    await this.embeddingService.deleteProfileEmbedding(userId);

    // Invalidate all cached scores
    const invalidated = await this.matchScoreRepository.invalidateByUser(userId);
    this.logger.log(
      `Profile update for user ${userId}: invalidated ${invalidated} scores, re-embedding`,
    );

    // Enqueue embed-profile job
    await this.matchingQueue.add(
      MATCHING_JOBS.EMBED_PROFILE,
      { type: 'embed-profile', userId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 50 },
        removeOnFail: { age: 60 * 60 * 24 * 3 },
      },
    );

    // Enqueue compute-scores job (will run after embed completes)
    await this.matchingQueue.add(
      MATCHING_JOBS.COMPUTE_SCORES,
      { type: 'compute-scores', userId, jobIds: [] },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 50 },
        removeOnFail: { age: 60 * 60 * 24 * 3 },
      },
    );

    return { status: 'queued', invalidated };
  }

  /**
   * Called when new jobs are scraped for a user.
   * Embeds the new jobs, then computes scores for them.
   */
  async onNewJobsScraped(userId: string, jobIds: string[]) {
    if (jobIds.length === 0) return { status: 'no_jobs' };

    this.logger.log(
      `New jobs scraped for user ${userId}: ${jobIds.length} jobs — enqueuing embedding + scoring`,
    );

    // Enqueue embed-jobs job
    await this.matchingQueue.add(
      MATCHING_JOBS.EMBED_JOBS,
      { type: 'embed-jobs', jobIds },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 50 },
        removeOnFail: { age: 60 * 60 * 24 * 3 },
      },
    );

    // Enqueue compute-scores for the specific new jobs
    await this.matchingQueue.add(
      MATCHING_JOBS.COMPUTE_SCORES,
      { type: 'compute-scores', userId, jobIds },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 50 },
        removeOnFail: { age: 60 * 60 * 24 * 3 },
      },
    );

    return { status: 'queued', jobCount: jobIds.length };
  }

  /**
   * Get the status of a matching queue job by its BullMQ job ID.
   */
  async getJobStatus(jobId: string) {
    const job: Job<MatchingJobData, MatchingJobResult> | undefined =
      await this.matchingQueue.getJob(jobId);

    if (!job) {
      return null;
    }

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
}
