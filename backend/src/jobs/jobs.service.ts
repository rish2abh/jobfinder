import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { JobsRepository } from './jobs.repository';
import { UsersService } from '../users/users.service';
import type { JobSource } from './job.schema';
import {
  JOB_SCRAPE_JOB,
  JOB_SCRAPE_QUEUE,
  SCRAPE_CACHE_TTL_MS,
  ScrapeJobData,
  ScrapeJobResult,
} from './job-scrape.types';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectQueue(JOB_SCRAPE_QUEUE)
    private readonly scrapeQueue: Queue<ScrapeJobData, ScrapeJobResult>,
    private readonly jobsRepository: JobsRepository,
    private readonly usersService: UsersService,
  ) {}

  // ── Trigger scrape ─────────────────────────────────────────────────────────

  /**
   * Enqueues a scrape job for the given user's skills.
   * If fresh results (<24h) already exist for those skills, returns the cache
   * instead of re-scraping (unless force=true).
   */
  async triggerScrape(
    userId: string,
    skills: string[],
    options: { force?: boolean; sources?: JobSource[]; maxPerSource?: number; companies?: string[]; keywords?: string[]; country?: string } = {},
  ): Promise<{ jobId: string; status: 'queued' } | { status: 'cached'; count: number }> {
    await this.usersService.findById(userId);

    // Always queue a fresh scrape — never skip based on cache
    const data: ScrapeJobData = {
      userId,
      skills,
      companies:    options.companies,
      keywords:     options.keywords,
      sources:      options.sources,
      maxPerSource: options.maxPerSource ?? 30,
      country:      options.country,
    };

    const job = await this.scrapeQueue.add(JOB_SCRAPE_JOB, data, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 100 },
      removeOnFail:     { age: 60 * 60 * 24 * 3 },
    });

    this.logger.log(`Scrape job ${job.id} enqueued for user ${userId} — skills=[${skills.join(', ')}]${options.country ? ` country=${options.country}` : ''}`);
    return { jobId: String(job.id), status: 'queued' };
  }

  // ── Get scrape job status ──────────────────────────────────────────────────

  async getScrapeJobStatus(jobId: string) {
    const job: Job<ScrapeJobData, ScrapeJobResult> | undefined =
      await this.scrapeQueue.getJob(jobId);

    if (!job) throw new NotFoundException(`Scrape job ${jobId} not found`);

    const state = await job.getState();

    return {
      jobId:        String(job.id),
      state,
      progress:     typeof job.progress === 'number' ? job.progress : 0,
      result:       job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
    };
  }

  // ── Query stored jobs ──────────────────────────────────────────────────────

  /**
   * Experience-level → title/JD keyword mapping.
   * Each level includes its own terms plus all terms below it.
   */
  private static readonly EXPERIENCE_KEYWORDS: Record<string, string[]> = {
    internship: ['intern', 'internship', 'trainee', 'apprentice'],
    entry:      ['entry', 'junior', 'fresher', 'graduate', 'associate', '0-1', '0-2'],
    mid:        ['mid', 'intermediate', '2-4', '3-5', '2-5'],
    senior:     ['senior', 'lead', 'sr.', 'sr ', 'staff', 'principal', '5+', '6+', '7+'],
    manager:    ['manager', 'director', 'head of', 'vp ', 'vice president', 'architect'],
  };

  /**
   * Derive experience keywords from user's work-experience entries in their profile.
   * Total years of experience is estimated from start/end dates.
   */
  private deriveExperienceKeywords(
    profileExperience?: Array<{ startDate?: string; endDate?: string; title?: string }>,
  ): string[] | undefined {
    if (!profileExperience?.length) return undefined;

    // Estimate total years from experience entries
    let totalMonths = 0;
    for (const exp of profileExperience) {
      const start = exp.startDate ? new Date(exp.startDate) : null;
      const end   = exp.endDate   ? new Date(exp.endDate)   : new Date();
      if (start && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        totalMonths += Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
      }
    }
    const totalYears = totalMonths / 12;

    if (totalYears < 0.5)  return JobsService.EXPERIENCE_KEYWORDS.internship;
    if (totalYears < 2)    return JobsService.EXPERIENCE_KEYWORDS.entry;
    if (totalYears < 5)    return JobsService.EXPERIENCE_KEYWORDS.mid;
    if (totalYears < 10)   return JobsService.EXPERIENCE_KEYWORDS.senior;
    return JobsService.EXPERIENCE_KEYWORDS.manager;
  }

  async getJobsForUser(
    userId: string,
    options: {
      skills?: string[];
      limit?: number;
      skip?: number;
      source?: JobSource;
      experienceLevel?: string;   // 'auto' | 'internship' | 'entry' | 'mid' | 'senior' | 'manager' | 'any'
      sortBy?: 'postedAt' | 'scrapedAt';
    } = {},
  ) {
    // Get user's skills and profile from parsed resume if not provided
    let skills = options.skills ?? [];
    let experienceKeywords: string[] | undefined;

    const user = await this.usersService.findById(userId);

    if (skills.length === 0) {
      const resumeSkills = (user.resume as any)?.skills;
      if (Array.isArray(resumeSkills)) {
        skills = resumeSkills.map(String);
      }
    }

    // Resolve experience keywords
    if (options.experienceLevel && options.experienceLevel !== 'any') {
      if (options.experienceLevel === 'auto') {
        // Derive from user's profile experience — if none found, skip filter (show all)
        const profileExp = (user.profile as any)?.experience;
        experienceKeywords = this.deriveExperienceKeywords(profileExp);
        // If auto couldn't determine level (no experience data), don't filter
        if (!experienceKeywords?.length) experienceKeywords = undefined;
      } else if (JobsService.EXPERIENCE_KEYWORDS[options.experienceLevel]) {
        experienceKeywords = JobsService.EXPERIENCE_KEYWORDS[options.experienceLevel];
      }
    }

    const [jobs, total] = await Promise.all([
      this.jobsRepository.findBySkills(skills, {
        limit:              options.limit ?? 50,
        skip:               options.skip  ?? 0,
        source:             options.source,
        excludeFlagged:     true,
        experienceKeywords,
        sortBy:             options.sortBy ?? 'postedAt',
      }),
      this.jobsRepository.countBySkills(skills, {
        source:             options.source,
        experienceKeywords,
      }),
    ]);

    return { jobs, total, skills };
  }

  // ── Get skills from user's parsed resume ───────────────────────────────────

  async getSkillsFromResume(userId: string): Promise<string[]> {
    const user = await this.usersService.findById(userId);
    const resumeSkills = (user.resume as any)?.skills;
    if (Array.isArray(resumeSkills)) return resumeSkills.map(String);
    return [];
  }

  // ── Cache management ──────────────────────────────────────────────────────

  async getCacheStats() {
    return this.jobsRepository.getCacheStats();
  }

  async getCacheJobs(options: { limit?: number; skip?: number; source?: JobSource }) {
    return this.jobsRepository.listAll(options);
  }

  async deleteCacheById(id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.jobsRepository.deleteById(id);
    return { deleted };
  }

  async deleteCacheBySource(source: JobSource): Promise<{ deleted: number }> {
    const deleted = await this.jobsRepository.deleteBySource(source);
    this.logger.log(`Cache cleared for source "${source}" — ${deleted} jobs removed`);
    return { deleted };
  }

  async deleteAllCache(): Promise<{ deleted: number }> {
    const deleted = await this.jobsRepository.deleteAll();
    this.logger.log(`Full cache cleared — ${deleted} jobs removed`);
    return { deleted };
  }

  // ── Cleanup old jobs ───────────────────────────────────────────────────────

  async cleanupOldJobs(olderThanDays = 30): Promise<{ deleted: number }> {
    const deleted = await this.jobsRepository.deleteOlderThan(olderThanDays);
    this.logger.log(`Cleaned up ${deleted} jobs older than ${olderThanDays} days`);
    return { deleted };
  }

  // ── Clear captcha flags ────────────────────────────────────────────────────

  async clearCaptchaFlags(): Promise<{ fixed: number }> {
    const fixed = await this.jobsRepository.clearCaptchaFlags();
    this.logger.log(`Cleared captcha flags from ${fixed} jobs`);
    return { fixed };
  }
}
