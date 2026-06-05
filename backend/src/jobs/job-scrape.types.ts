import type { JobSource } from './job.schema';

export const JOB_SCRAPE_QUEUE = 'job-scrape';
export const JOB_SCRAPE_JOB   = 'scrape-jobs';

/** Cache TTL — do not re-scrape the same query within 24 hours */
export const SCRAPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** How many top-matched jobs to fetch full JD for */
export const JD_FETCH_TOP_N = 10;

/** Minimum delay between Playwright page navigations (ms) */
export const MIN_DELAY_MS = 2000;

/** Maximum delay between Playwright page navigations (ms) */
export const MAX_DELAY_MS = 5000;

export interface ScrapeJobData {
  /** userId who triggered the scrape */
  userId: string;

  /** Skill keywords derived from the user's parsed resume or entered manually */
  skills: string[];

  /**
   * Optional list of target company names.
   * When provided, the scraper builds company-specific queries:
   * e.g. skills=['React'] + companies=['Google'] → "React developer at Google"
   */
  companies?: string[];

  /**
   * Optional free-text search keywords — appended directly to queries.
   * e.g. keywords=['remote', 'senior'] → "React remote senior developer"
   */
  keywords?: string[];

  /** Sources to scrape — defaults to all available */
  sources?: JobSource[];

  /** Max results to store per source */
  maxPerSource?: number;

  /** Country/location to search jobs in */
  country?: string;
}

export interface ScrapedRawJob {
  title: string;
  company: string;
  location?: string;
  postedAt?: string;
  applyUrl?: string;
  scrapeUrl?: string;
  jd?: string;
  contactEmail?: string;
  source: JobSource;
  flagged?: boolean;
  flagReason?: string;
  /** The company that was specifically targeted, if any */
  targetCompany?: string;
}

export interface ScrapeJobResult {
  userId: string;
  skills: string[];
  companies: string[];
  keywords: string[];
  country?: string;
  totalFound: number;
  totalStored: number;
  totalDuplicates: number;
  totalFlagged: number;
  bySource: Record<string, number>;
  durationMs: number;
}
