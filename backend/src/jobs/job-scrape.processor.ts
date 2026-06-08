import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { launchBrowser } from './scraper/browser.helper';
import { scrapeIndeed } from './scraper/indeed.scraper';
import { scrapeNaukri } from './scraper/naukri.scraper';
import { scrapeInternshala } from './scraper/internshala.scraper';
import { scrapeJSearch } from './scraper/jsearch.scraper';
import { scrapeGoogleJobs } from './scraper/google-jobs.scraper';
import { fetchJdsForTopJobs } from './scraper/jd-fetcher';
import { buildSearchQueries, matchSkills } from './scraper/query-builder';
import { JobsRepository } from './jobs.repository';
import { buildDedupeHash } from './job.schema';
import { MatchingService } from '../matching/matching.service';
import { WinstonLoggerService } from '../logger/winston-logger.service';
import {
  JOB_SCRAPE_JOB,
  JOB_SCRAPE_QUEUE,
  JD_FETCH_TOP_N,
  ScrapeJobData,
  ScrapeJobResult,
  ScrapedRawJob,
} from './job-scrape.types';

@Processor(JOB_SCRAPE_QUEUE)
export class JobScrapeProcessor extends WorkerHost {
  private readonly context = 'JobScrapeProcessor';

  constructor(
    private readonly configService: ConfigService,
    private readonly jobsRepository: JobsRepository,
    @Inject(forwardRef(() => MatchingService))
    private readonly matchingService: MatchingService,
    private readonly logger: WinstonLoggerService,
  ) {
    super();
  }

  async process(job: Job<ScrapeJobData, ScrapeJobResult>): Promise<ScrapeJobResult> {
    if (job.name !== JOB_SCRAPE_JOB) throw new Error(`Unknown job: ${job.name}`);

    const start = Date.now();
    const {
      userId,
      skills    = [],
      companies = [],
      keywords  = [],
      sources,
      maxPerSource = 30,
      country,
    } = job.data;

    // Append country to keywords so it's included in every search query
    const effectiveKeywords = country
      ? [...keywords, country]
      : keywords;

    this.logger.info('Job started', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: JOB_SCRAPE_QUEUE,
      skills,
      companies,
      keywords: effectiveKeywords,
      country,
    });

    await job.updateProgress(5);

    // ── 1. Build search queries ────────────────────────────────────────────
    const queries = buildSearchQueries(skills, companies, effectiveKeywords);
    this.logger.info(`Job progress: built ${queries.length} search queries`, {
      context: this.context,
      jobId: job.id,
      userId,
      queue: JOB_SCRAPE_QUEUE,
    });

    const enabledSources = sources ?? ['google', 'jsearch', 'naukri', 'internshala', 'indeed'];
    let allRaw: ScrapedRawJob[] = [];

    try {
    // ── 2. JSearch — API, no browser, runs first ───────────────────────────
    if (enabledSources.includes('jsearch')) {
      await job.updateProgress(8);
      const apiKey = this.configService.get<string>('JSEARCH_API_KEY') ?? '';
      for (const q of queries) {
        const jsearchJobs = await scrapeJSearch(apiKey, q, maxPerSource);
        const targetCo = this.extractTargetCompany(q, companies);
        jsearchJobs.forEach((j) => { if (targetCo) j.targetCompany = targetCo; });
        allRaw.push(...jsearchJobs);
      }
      this.logger.info(`Job progress: JSearch scraped ${allRaw.length} results`, {
        context: this.context,
        jobId: job.id,
        userId,
        queue: JOB_SCRAPE_QUEUE,
      });
    }

    // ── 3. Launch browser for Playwright scrapers ─────────────────────────
    const browser = await launchBrowser();

    try {
      // ── Google Jobs ──────────────────────────────────────────────────────
      if (enabledSources.includes('google')) {
        await job.updateProgress(15);
        for (const q of queries) {
          const targetCo = this.extractTargetCompany(q, companies);
          try {
            const googleJobs = await scrapeGoogleJobs(browser, q, targetCo, maxPerSource);
            allRaw.push(...googleJobs);
            this.logger.info(`Job progress: Google Jobs "${q}" returned ${googleJobs.length}`, {
              context: this.context,
              jobId: job.id,
              userId,
              queue: JOB_SCRAPE_QUEUE,
            });
          } catch (err: any) {
            this.logger.warn(`Google Jobs failed for "${q}": ${err?.message}`, this.context);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      // ── Indeed ───────────────────────────────────────────────────────────
      if (enabledSources.includes('indeed')) {
        await job.updateProgress(30);
        for (const q of queries.slice(0, 2)) {
          try {
            const indeedJobs = await scrapeIndeed(browser, q, country ?? '', maxPerSource);
            allRaw.push(...indeedJobs);
            this.logger.info(`Job progress: Indeed "${q}" returned ${indeedJobs.length}`, {
              context: this.context,
              jobId: job.id,
              userId,
              queue: JOB_SCRAPE_QUEUE,
            });
          } catch (err: any) {
            this.logger.warn(`Indeed failed: ${err?.message}`, this.context);
          }
        }
      }

      // ── Naukri ───────────────────────────────────────────────────────────
      if (enabledSources.includes('naukri')) {
        await job.updateProgress(45);
        try {
          const naukriJobs = await scrapeNaukri(browser, queries[0], country ?? '', maxPerSource);
          allRaw.push(...naukriJobs);
          this.logger.info(`Job progress: Naukri returned ${naukriJobs.length}`, {
            context: this.context,
            jobId: job.id,
            userId,
            queue: JOB_SCRAPE_QUEUE,
          });
        } catch (err: any) {
          this.logger.warn(`Naukri failed: ${err?.message}`, this.context);
        }
      }

      // ── Internshala ──────────────────────────────────────────────────────
      if (enabledSources.includes('internshala')) {
        await job.updateProgress(58);
        try {
          const internshalaJobs = await scrapeInternshala(browser, queries[0], maxPerSource);
          allRaw.push(...internshalaJobs);
          this.logger.info(`Job progress: Internshala returned ${internshalaJobs.length}`, {
            context: this.context,
            jobId: job.id,
            userId,
            queue: JOB_SCRAPE_QUEUE,
          });
        } catch (err: any) {
          this.logger.warn(`Internshala failed: ${err?.message}`, this.context);
        }
      }

      await job.updateProgress(65);

      // ── 4. Keyword matching ───────────────────────────────────────────────
      const matchedSkillsMap = new Map<string, string[]>();
      for (const raw of allRaw) {
        const searchText = `${raw.title} ${raw.company} ${raw.jd ?? ''}`;
        const matched = matchSkills(skills, searchText);
        const hash = buildDedupeHash(raw.title, raw.company);
        matchedSkillsMap.set(hash, matched);
      }

      // ── 5. Fetch full JDs for top matches ──────────────────────────────────
      const topMatches = allRaw
        .filter((r) => !r.jd && !r.flagged && r.applyUrl)
        .sort((a, b) => {
          const ha = buildDedupeHash(a.title, a.company);
          const hb = buildDedupeHash(b.title, b.company);
          return (matchedSkillsMap.get(hb)?.length ?? 0) -
                 (matchedSkillsMap.get(ha)?.length ?? 0);
        })
        .slice(0, JD_FETCH_TOP_N);

      if (topMatches.length > 0) {
        await job.updateProgress(72);
        this.logger.info(`Job progress: fetching JDs for ${topMatches.length} top matches`, {
          context: this.context,
          jobId: job.id,
          userId,
          queue: JOB_SCRAPE_QUEUE,
        });
        await fetchJdsForTopJobs(browser, topMatches);

        for (const raw of topMatches) {
          const searchText = `${raw.title} ${raw.company} ${raw.jd ?? ''}`;
          const matched = matchSkills(skills, searchText);
          const hash = buildDedupeHash(raw.title, raw.company);
          matchedSkillsMap.set(hash, matched);
        }
      }

    } finally {
      await browser.close().catch(() => undefined);
    }

    await job.updateProgress(85);

    // ── 6. Extract contact emails from JDs ────────────────────────────────
    for (const raw of allRaw) {
      if (raw.jd && !raw.contactEmail) {
        raw.contactEmail = this.extractEmailFromText(raw.jd);
      }
    }

    // ── 7. Store ──────────────────────────────────────────────────────────
    this.logger.info(`Job progress: storing ${allRaw.length} raw results`, {
      context: this.context,
      jobId: job.id,
      userId,
      queue: JOB_SCRAPE_QUEUE,
    });

    const finalSkillsMap = new Map<string, string[]>();
    for (const raw of allRaw) {
      const searchText = `${raw.title} ${raw.company} ${raw.jd ?? ''}`;
      const matched = matchSkills(skills, searchText);
      const hash = buildDedupeHash(raw.title, raw.company);
      finalSkillsMap.set(hash, matched);
    }

    const { inserted, duplicates } = await this.jobsRepository.bulkUpsert(
      allRaw,
      finalSkillsMap,
      effectiveKeywords,
    );

    await job.updateProgress(100);

    const flagged  = allRaw.filter((r) => r.flagged).length;
    const bySource: Record<string, number> = {};
    for (const r of allRaw) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

    const result: ScrapeJobResult = {
      userId, skills, companies,
      keywords: effectiveKeywords,
      country,
      totalFound:      allRaw.length,
      totalStored:     inserted,
      totalDuplicates: duplicates,
      totalFlagged:    flagged,
      bySource,
      durationMs: Date.now() - start,
    };

    this.logger.info('Job completed', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: JOB_SCRAPE_QUEUE,
      durationMs: result.durationMs,
      totalFound: allRaw.length,
      totalStored: inserted,
      totalDuplicates: duplicates,
      totalFlagged: flagged,
    });

    // ── Trigger matching: embed new jobs and compute scores ────────────────
    if (inserted > 0 && userId) {
      try {
        // Get IDs of freshly inserted jobs (scraped within last minute)
        const recentJobs = await this.jobsRepository.findBySkills(skills, {
          limit: inserted,
          sortBy: 'scrapedAt',
        });
        const newJobIds = recentJobs.map((j) => j._id.toString());

        if (newJobIds.length > 0) {
          await this.matchingService.onNewJobsScraped(userId, newJobIds);
          this.logger.info(`Matching enqueued for ${newJobIds.length} new jobs`, {
            context: this.context,
            jobId: job.id,
            userId,
            queue: JOB_SCRAPE_QUEUE,
          });
        }
      } catch (matchErr: any) {
        // Non-blocking — don't fail the scrape job if matching enqueue fails
        this.logger.warn(
          `Failed to enqueue matching for user ${userId}: ${matchErr?.message}`,
          this.context,
        );
      }
    }

    return result;

    } catch (err: any) {
      const durationMs = Date.now() - start;
      this.logger.errorWithMeta('Job failed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: JOB_SCRAPE_QUEUE,
        durationMs,
        trace: err?.stack || String(err),
      });
      throw err;
    }
  }

  /** Extract first email address found in text */
  private extractEmailFromText(text: string): string | undefined {
    const match = text.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/);
    return match?.[0];
  }

  private extractTargetCompany(query: string, companies: string[]): string | undefined {
    for (const company of companies) {
      if (query.toLowerCase().includes(company.toLowerCase())) return company;
    }
    return undefined;
  }
}
