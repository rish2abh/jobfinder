import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { UsersService } from '../users/users.service';
import { JobsRepository } from '../jobs/jobs.repository';
import { EmbeddingService, JobEmbeddingInput } from './embedding.service';
import { MatchScoreRepository, BulkScoreEntry } from './match-score.repository';
import { computeMatchScore } from './score-calculator';
import { WinstonLoggerService } from '../logger/winston-logger.service';
import {
  MATCHING_QUEUE,
  EmbedProfileJobData,
  EmbedJobsJobData,
  ComputeScoresJobData,
  MatchingJobData,
  MatchingJobResult,
} from './matching.types';

@Processor(MATCHING_QUEUE)
export class MatchingProcessor extends WorkerHost {
  private readonly context = 'MatchingProcessor';
  private static readonly BATCH_SIZE = 50;

  constructor(
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => JobsRepository))
    private readonly jobsRepository: JobsRepository,
    private readonly embeddingService: EmbeddingService,
    private readonly matchScoreRepository: MatchScoreRepository,
    private readonly logger: WinstonLoggerService,
  ) {
    super();
  }

  async process(job: Job<MatchingJobData, MatchingJobResult>): Promise<MatchingJobResult> {
    const { type } = job.data;
    const userId = (job.data as any).userId;
    const startTime = Date.now();

    this.logger.info('Job started', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: MATCHING_QUEUE,
      type,
    });

    try {
      let result: MatchingJobResult;

      switch (type) {
        case 'embed-profile':
          result = await this.handleEmbedProfile(job as Job<EmbedProfileJobData, MatchingJobResult>);
          break;
        case 'embed-jobs':
          result = await this.handleEmbedJobs(job as Job<EmbedJobsJobData, MatchingJobResult>);
          break;
        case 'compute-scores':
          result = await this.handleComputeScores(job as Job<ComputeScoresJobData, MatchingJobResult>);
          break;
        default:
          throw new Error(`Unknown matching job type: ${(job.data as any).type}`);
      }

      const durationMs = Date.now() - startTime;
      this.logger.info('Job completed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MATCHING_QUEUE,
        durationMs,
        type,
      });

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.logger.errorWithMeta('Job failed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MATCHING_QUEUE,
        durationMs,
        type,
        trace: err?.stack || String(err),
      });
      throw err;
    }
  }

  // ── embed-profile ────────────────────────────────────────────────────────

  private async handleEmbedProfile(
    job: Job<EmbedProfileJobData, MatchingJobResult>,
  ): Promise<MatchingJobResult> {
    const { userId } = job.data;

    await job.updateProgress(10);

    // 1. Fetch user profile
    const profile = await this.usersService.getProfile(userId);

    // 2. Build text representation from profile data
    const text = this.buildProfileText(profile);

    if (!text.trim()) {
      this.logger.warn(`User ${userId} has empty profile — skipping embedding`, this.context);
      return { type: 'embed-profile', success: false, details: { reason: 'empty_profile' } };
    }

    await job.updateProgress(30);

    // 3. Generate and store embedding in ChromaDB
    const success = await this.embeddingService.upsertProfileEmbedding(userId, text, {
      userId,
      lastUpdated: new Date().toISOString(),
    });

    await job.updateProgress(100);

    this.logger.info(`Job progress: embed-profile for user ${userId} — ${success ? 'success' : 'failed'}`, {
      context: this.context,
      jobId: job.id,
      userId,
      queue: MATCHING_QUEUE,
    });

    return { type: 'embed-profile', success, details: { userId, textLength: text.length } };
  }

  // ── embed-jobs ───────────────────────────────────────────────────────────

  private async handleEmbedJobs(
    job: Job<EmbedJobsJobData, MatchingJobResult>,
  ): Promise<MatchingJobResult> {
    const { jobIds } = job.data;

    await job.updateProgress(5);

    // 1. Fetch job documents from MongoDB
    const jobDocs = await this.jobsRepository.findByIds(jobIds);

    if (jobDocs.length === 0) {
      this.logger.warn('No jobs found for provided IDs', this.context);
      return { type: 'embed-jobs', success: true, details: { embedded: 0, failed: 0 } };
    }

    await job.updateProgress(15);

    // 2. Build embedding inputs
    const embeddingInputs: JobEmbeddingInput[] = jobDocs
      .filter((doc) => doc.jd && doc.jd.trim().length > 0)
      .map((doc) => ({
        jobId: doc._id.toString(),
        text: this.buildJobText(doc),
        metadata: {
          jobId: doc._id.toString(),
          title: doc.title,
          company: doc.company,
          source: doc.source,
        },
      }));

    // 3. Batch into groups of 50 and embed
    const batches = this.embeddingService.splitIntoBatches(
      embeddingInputs,
      MatchingProcessor.BATCH_SIZE,
    );

    let totalEmbedded = 0;
    let totalFailed = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const result = await this.embeddingService.upsertJobEmbeddings(batch);
      totalEmbedded += result.embedded;
      totalFailed += result.failed;

      // Report progress proportionally
      const progress = Math.min(95, 15 + Math.round((i + 1) / batches.length * 80));
      await job.updateProgress(progress);
    }

    await job.updateProgress(100);

    const skipped = jobDocs.length - embeddingInputs.length;
    this.logger.info(`Job progress: embed-jobs complete — embedded: ${totalEmbedded}, failed: ${totalFailed}, skipped: ${skipped}`, {
      context: this.context,
      jobId: job.id,
      queue: MATCHING_QUEUE,
    });

    return {
      type: 'embed-jobs',
      success: true,
      details: { embedded: totalEmbedded, failed: totalFailed, skipped },
    };
  }

  // ── compute-scores ───────────────────────────────────────────────────────

  private async handleComputeScores(
    job: Job<ComputeScoresJobData, MatchingJobResult>,
  ): Promise<MatchingJobResult> {
    const { userId, jobIds: requestedJobIds } = job.data;

    await job.updateProgress(10);

    // 1. Get user's skills from profile
    const profile = await this.usersService.getProfile(userId);
    const resumeSkills: string[] = profile.skills ?? [];

    await job.updateProgress(20);

    // 2. Resolve job IDs — if empty, fetch all jobs matching the user's skills
    let jobIds = requestedJobIds;
    if (!jobIds || jobIds.length === 0) {
      const allJobs = await this.jobsRepository.findBySkills(resumeSkills, { limit: 500 });
      jobIds = allJobs.map((j) => j._id.toString());
    }

    if (jobIds.length === 0) {
      this.logger.info('Job progress: no jobs to score', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MATCHING_QUEUE,
      });
      await job.updateProgress(100);
      return { type: 'compute-scores', success: true, details: { userId, totalScores: 0, degraded: false } };
    }

    // 3. Query similarity from ChromaDB
    const similarityResults = await this.embeddingService.querySimilarity(userId, jobIds);

    await job.updateProgress(50);

    // 3. Compute final scores
    const scores: BulkScoreEntry[] = [];
    const now = new Date();

    if (similarityResults && similarityResults.length > 0) {
      // Normal mode: use ChromaDB similarity + skill overlap
      const jobDocs = await this.jobsRepository.findByIds(jobIds);
      const jobMap = new Map(jobDocs.map((doc) => [doc._id.toString(), doc]));

      for (const result of similarityResults) {
        const jobDoc = jobMap.get(result.jobId);
        const jobKeywords = this.extractJobKeywords(jobDoc);

        const { finalScore, skillOverlap } = computeMatchScore(
          result.similarity,
          resumeSkills,
          jobKeywords,
        );

        scores.push({
          userId,
          jobId: result.jobId,
          cosineSimilarity: result.similarity,
          skillOverlap,
          finalScore,
          degraded: false,
          computedAt: now,
        });
      }

      // Handle jobs that didn't get similarity results (not embedded yet)
      const scoredJobIds = new Set(similarityResults.map((r) => r.jobId));
      for (const jobId of jobIds) {
        if (!scoredJobIds.has(jobId)) {
          const jobDoc = jobMap.get(jobId);
          const jobKeywords = this.extractJobKeywords(jobDoc);
          const { finalScore, skillOverlap } = computeMatchScore(0, resumeSkills, jobKeywords);

          scores.push({
            userId,
            jobId,
            cosineSimilarity: 0,
            skillOverlap,
            finalScore,
            degraded: true,
            computedAt: now,
          });
        }
      }
    } else {
      // Degraded mode: ChromaDB/Ollama unavailable — keyword-only matching
      this.logger.warn(
        'ChromaDB similarity unavailable — using keyword-only fallback',
        this.context,
      );

      const jobDocs = await this.jobsRepository.findByIds(jobIds);

      for (const jobDoc of jobDocs) {
        const jobKeywords = this.extractJobKeywords(jobDoc);
        const { finalScore, skillOverlap } = computeMatchScore(0, resumeSkills, jobKeywords);

        scores.push({
          userId,
          jobId: jobDoc._id.toString(),
          cosineSimilarity: 0,
          skillOverlap,
          finalScore,
          degraded: true,
          computedAt: now,
        });
      }
    }

    await job.updateProgress(80);

    // 4. Bulk upsert scores into MongoDB
    if (scores.length > 0) {
      const result = await this.matchScoreRepository.bulkUpsert(scores);
      this.logger.info(`Job progress: compute-scores upserted ${result.upserted}, modified ${result.modified}`, {
        context: this.context,
        jobId: job.id,
        userId,
        queue: MATCHING_QUEUE,
      });
    }

    await job.updateProgress(100);

    return {
      type: 'compute-scores',
      success: true,
      details: {
        userId,
        totalScores: scores.length,
        degraded: scores.some((s) => s.degraded),
      },
    };
  }

  // ── Helper methods ───────────────────────────────────────────────────────

  /**
   * Build a text representation of the user's profile for embedding.
   * Combines skills, experience, and education into a single string.
   */
  private buildProfileText(profile: {
    name: string;
    email: string;
    skills?: string[];
    experience?: Array<{ company?: string; title?: string; description?: string }>;
    education?: Array<{ institution?: string; degree?: string; field?: string }>;
    headline?: string;
    bio?: string;
  }): string {
    const parts: string[] = [];

    if (profile.headline) {
      parts.push(`Headline: ${profile.headline}`);
    }

    if (profile.bio) {
      parts.push(`Summary: ${profile.bio}`);
    }

    if (profile.skills?.length) {
      parts.push(`Skills: ${profile.skills.join(', ')}`);
    }

    if (profile.experience?.length) {
      const expText = profile.experience
        .map((exp) => {
          const pieces = [exp.title, exp.company, exp.description].filter(Boolean);
          return pieces.join(' at ');
        })
        .join('; ');
      parts.push(`Experience: ${expText}`);
    }

    if (profile.education?.length) {
      const eduText = profile.education
        .map((edu) => [edu.degree, edu.field, edu.institution].filter(Boolean).join(' from '))
        .join('; ');
      parts.push(`Education: ${eduText}`);
    }

    return parts.join('. ');
  }

  /**
   * Build a text representation of a job for embedding.
   */
  private buildJobText(jobDoc: {
    title: string;
    company: string;
    location?: string;
    jd?: string;
  }): string {
    const parts = [
      `Title: ${jobDoc.title}`,
      `Company: ${jobDoc.company}`,
    ];

    if (jobDoc.location) {
      parts.push(`Location: ${jobDoc.location}`);
    }

    if (jobDoc.jd) {
      // Truncate JD to avoid overly long text
      const truncatedJd = jobDoc.jd.length > 4000 ? jobDoc.jd.slice(0, 4000) : jobDoc.jd;
      parts.push(`Description: ${truncatedJd}`);
    }

    return parts.join('. ');
  }

  /**
   * Extract keywords from a job document for skill overlap calculation.
   * Combines title, matchedSkills, and queryKeywords.
   */
  private extractJobKeywords(
    jobDoc?: { title?: string; matchedSkills?: string[]; queryKeywords?: string[]; jd?: string } | null,
  ): string[] {
    if (!jobDoc) return [];

    const keywords: string[] = [];

    // Use matchedSkills as primary keywords
    if (jobDoc.matchedSkills?.length) {
      keywords.push(...jobDoc.matchedSkills);
    }

    // Add queryKeywords
    if (jobDoc.queryKeywords?.length) {
      keywords.push(...jobDoc.queryKeywords);
    }

    // Extract words from title as additional keywords
    if (jobDoc.title) {
      const titleWords = jobDoc.title
        .split(/[\s,/|()]+/)
        .filter((w) => w.length > 2);
      keywords.push(...titleWords);
    }

    // Deduplicate (case-insensitive)
    const seen = new Set<string>();
    return keywords.filter((kw) => {
      const lower = kw.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  }
}
