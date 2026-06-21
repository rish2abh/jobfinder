import { Injectable, Logger } from '@nestjs/common';
import { AgentTool } from './tool-registry';
import { GeminiFunctionDeclaration } from '../gemini-client.service';
import { JobsService } from '../../jobs/jobs.service';
import { JobsRepository } from '../../jobs/jobs.repository';
import { MatchingService } from '../../matching/matching.service';

/**
 * Wraps JobsService (discovery/search/scrape) + MatchingService (scores/recompute).
 * Exposed as two Gemini tool declarations: `search_jobs` and `match_scores`.
 *
 * triggerScrape and recompute return queued jobIds — since this runs inside
 * AgentProcessor (a BullMQ worker, not an HTTP handler) we can safely poll
 * until completion with short delays.
 */
@Injectable()
export class JobTools implements AgentTool {
  private readonly logger = new Logger(JobTools.name);
  readonly name = 'search_jobs';

  readonly declaration: GeminiFunctionDeclaration = {
    name: 'search_jobs',
    description:
      'Discover jobs by searching cached listings or triggering a fresh scrape. ' +
      'Also retrieves AI match scores between user profile and jobs.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'scrape', 'get_scores', 'recompute_scores'],
          description:
            'search = query cached jobs; scrape = trigger fresh scrape; ' +
            'get_scores = fetch match scores; recompute_scores = force recalculate',
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skills/keywords to filter by',
        },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['indeed', 'naukri', 'internshala', 'google', 'jsearch'] },
          description: 'Job platforms to scrape (scrape action only)',
        },
        keyword: {
          type: 'string',
          description: 'Keyword filter for title/description',
        },
        companies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target specific companies',
        },
        country: {
          type: 'string',
          description: 'Country filter (e.g. "India", "US")',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 10)',
        },
        minScore: {
          type: 'number',
          description: 'Minimum match score threshold 0-100 (get_scores only)',
        },
      },
      required: ['action'],
    },
  };

  constructor(
    private readonly jobsService: JobsService,
    private readonly jobsRepository: JobsRepository,
    private readonly matchingService: MatchingService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId as string;
    const action = args.action as string;
    const limit = (args.limit as number) || 10;

    switch (action) {
      case 'search':
        return this.searchJobs(userId, args, limit);

      case 'scrape':
        return this.triggerScrapeAndPoll(userId, args);

      case 'get_scores':
        return this.getMatchScores(userId, limit, args.minScore as number);

      case 'recompute_scores':
        return this.recomputeAndPoll(userId);

      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async searchJobs(userId: string, args: Record<string, unknown>, limit: number) {
    const skills = (args.skills as string[]) || [];
    const result = await this.jobsService.getJobsForUser(userId, {
      skills,
      keyword: args.keyword as string,
      limit,
      skip: 0,
    });

    return {
      jobs: (result as any).jobs?.slice(0, limit).map((j: any) => ({
        id: j._id?.toString(),
        title: j.title,
        company: j.company,
        location: j.location,
        source: j.source,
        applyUrl: j.applyUrl,
        postedAt: j.postedAt,
        experienceLevel: j.experienceLevel,
      })) ?? [],
      total: (result as any).total ?? 0,
    };
  }

  private async triggerScrapeAndPoll(userId: string, args: Record<string, unknown>) {
    const skills = (args.skills as string[]) || [];
    const resolvedSkills = skills.length > 0
      ? skills
      : await this.jobsService.getSkillsFromResume(userId);

    if (resolvedSkills.length === 0) {
      return {
        status: 'no_skills',
        message: 'No skills found. Upload and parse your resume first, or provide skills explicitly.',
      };
    }

    const enqueueResult = await this.jobsService.triggerScrape(userId, resolvedSkills, {
      sources: args.sources as any,
      companies: args.companies as string[],
      keywords: args.keyword ? [args.keyword as string] : undefined,
      country: args.country as string,
    });

    // If cached, return immediately
    if (enqueueResult.status === 'cached') {
      return enqueueResult;
    }

    // Poll until completion (safe — we're inside a BullMQ worker, not an HTTP handler)
    const jobId = (enqueueResult as any).jobId as string;
    this.logger.log(`Polling scrape job ${jobId} for user ${userId}`);

    const result = await this.pollScrapeJob(jobId);
    return result;
  }

  private async pollScrapeJob(jobId: string, maxWaitMs = 60_000): Promise<unknown> {
    const startTime = Date.now();
    const pollIntervalMs = 2000;

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.jobsService.getScrapeJobStatus(jobId);

      if (status.state === 'completed') {
        return {
          status: 'completed',
          jobId,
          result: status.result,
        };
      }

      if (status.state === 'failed') {
        return {
          status: 'failed',
          jobId,
          failedReason: status.failedReason,
        };
      }

      await this.sleep(pollIntervalMs);
    }

    return {
      status: 'timeout',
      jobId,
      message: `Scrape job did not complete within ${maxWaitMs / 1000}s. It is still processing.`,
    };
  }

  private async getMatchScores(userId: string, limit: number, minScore?: number) {
    const { scores, total } = await this.matchingService.getScores(userId, { limit });

    const filtered = minScore
      ? scores.filter((s: any) => s.finalScore >= minScore)
      : scores;

    // Enrich scores with actual job data (findByUser doesn't populate job refs)
    const jobIds = filtered.map((s: any) => s.jobId?.toString()).filter(Boolean);
    const jobs = await this.jobsRepository.findByIds(jobIds);
    const jobMap = new Map(jobs.map((j) => [j._id.toString(), j]));

    return {
      scores: filtered.map((s: any) => {
        const job = jobMap.get(s.jobId?.toString());
        return {
          jobId: s.jobId?.toString(),
          title: job?.title ?? 'Unknown',
          company: job?.company ?? 'Unknown',
          location: job?.location,
          finalScore: s.finalScore,
          applyUrl: job?.applyUrl,
        };
      }),
      total,
      returned: filtered.length,
    };
  }

  private async recomputeAndPoll(userId: string) {
    const enqueueResult = await this.matchingService.recompute(userId);
    const jobId = enqueueResult.jobId;

    this.logger.log(`Polling recompute job ${jobId} for user ${userId}`);

    const result = await this.pollMatchingJob(jobId);
    return {
      ...(result as Record<string, unknown>),
      invalidated: enqueueResult.invalidated,
    };
  }

  private async pollMatchingJob(jobId: string, maxWaitMs = 90_000): Promise<unknown> {
    const startTime = Date.now();
    const pollIntervalMs = 2000;

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.matchingService.getJobStatus(jobId);

      if (!status) {
        return { status: 'not_found', jobId };
      }

      if (status.state === 'completed') {
        return {
          status: 'completed',
          jobId,
          result: status.result,
        };
      }

      if (status.state === 'failed') {
        return {
          status: 'failed',
          jobId,
          failedReason: status.failedReason,
        };
      }

      await this.sleep(pollIntervalMs);
    }

    return {
      status: 'timeout',
      jobId,
      message: `Matching job did not complete within ${maxWaitMs / 1000}s. It is still processing.`,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
