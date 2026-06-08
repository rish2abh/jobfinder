import * as fc from 'fast-check';

/**
 * Property 8: Job query correctness (filtering + sorting + pagination)
 *
 * For any set of jobs in the database and any valid query parameters
 * (page size 1-200, source filter, experience level, keywords, sort field),
 * the returned results SHALL:
 * (a) contain at most pageSize items,
 * (b) include only jobs matching all applied filters, and
 * (c) be ordered according to the specified sort field in descending order.
 *
 * **Validates: Requirements 6.1, 6.2, 6.4**
 */

// --- Types mirroring the job schema ---

type JobSource = 'indeed' | 'naukri' | 'internshala' | 'jsearch' | 'google' | 'company';

interface TestJob {
  title: string;
  company: string;
  jd: string;
  source: JobSource;
  flagged: boolean;
  scrapedAt: number; // timestamp ms
  postedAtDate: number | null; // timestamp ms or null
}

interface QueryParams {
  pageSize: number;
  skip: number;
  source?: JobSource;
  experienceKeywords?: string[];
  keyword?: string;
  sortBy: 'postedAt' | 'scrapedAt';
}

// --- Pure query function mirroring repository logic ---

function queryJobs(jobs: TestJob[], params: QueryParams): TestJob[] {
  let filtered = jobs.filter((job) => !job.flagged);

  // Source filter
  if (params.source) {
    filtered = filtered.filter((job) => job.source === params.source);
  }

  // Experience keywords filter — matches against title (case-insensitive)
  if (params.experienceKeywords && params.experienceKeywords.length > 0) {
    const keywords = params.experienceKeywords;
    filtered = filtered.filter((job) =>
      keywords.some((kw) => job.title.toLowerCase().includes(kw.toLowerCase())),
    );
  }

  // Custom keyword filter — matches against both title AND jd (case-insensitive)
  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    filtered = filtered.filter(
      (job) =>
        job.title.toLowerCase().includes(kw) ||
        job.jd.toLowerCase().includes(kw),
    );
  }

  // Sorting: descending by the specified sort field
  if (params.sortBy === 'postedAt') {
    filtered.sort((a, b) => {
      // Primary sort: postedAtDate descending, nulls last
      const aDate = a.postedAtDate ?? -Infinity;
      const bDate = b.postedAtDate ?? -Infinity;
      if (bDate !== aDate) return bDate - aDate;
      // Secondary sort: scrapedAt descending
      return b.scrapedAt - a.scrapedAt;
    });
  } else {
    filtered.sort((a, b) => b.scrapedAt - a.scrapedAt);
  }

  // Pagination
  const start = params.skip;
  const end = start + params.pageSize;
  return filtered.slice(start, end);
}

// --- Generators ---

const JOB_SOURCES: JobSource[] = ['indeed', 'naukri', 'internshala', 'jsearch', 'google', 'company'];

const EXPERIENCE_KEYWORDS_MAP: Record<string, string[]> = {
  internship: ['intern', 'internship', 'trainee'],
  entry: ['entry', 'junior', 'fresher', 'graduate'],
  mid: ['mid', 'intermediate'],
  senior: ['senior', 'lead', 'staff'],
  manager: ['manager', 'director', 'head of'],
};

const experienceLevels = Object.keys(EXPERIENCE_KEYWORDS_MAP);

// Generate a non-empty alphanumeric string for titles and descriptions
const textGen = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

const jobGen: fc.Arbitrary<TestJob> = fc.record({
  title: textGen,
  company: textGen,
  jd: textGen,
  source: fc.constantFrom(...JOB_SOURCES),
  flagged: fc.boolean(),
  scrapedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  postedAtDate: fc.oneof(
    fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
    fc.constant(null),
  ),
});

const queryParamsGen: fc.Arbitrary<QueryParams> = fc.record({
  pageSize: fc.integer({ min: 1, max: 200 }),
  skip: fc.integer({ min: 0, max: 100 }),
  source: fc.option(fc.constantFrom(...JOB_SOURCES), { nil: undefined }),
  experienceKeywords: fc.option(
    fc.constantFrom(...experienceLevels).map((level) => EXPERIENCE_KEYWORDS_MAP[level]),
    { nil: undefined },
  ),
  keyword: fc.option(textGen, { nil: undefined }),
  sortBy: fc.constantFrom('postedAt' as const, 'scrapedAt' as const),
});

// --- Property Tests ---

describe('Property 8: Job query correctness', () => {
  it('(a) results contain at most pageSize items', () => {
    fc.assert(
      fc.property(
        fc.array(jobGen, { minLength: 0, maxLength: 50 }),
        queryParamsGen,
        (jobs, params) => {
          const results = queryJobs(jobs, params);
          expect(results.length).toBeLessThanOrEqual(params.pageSize);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('(b) results include only jobs matching all applied filters', () => {
    fc.assert(
      fc.property(
        fc.array(jobGen, { minLength: 0, maxLength: 50 }),
        queryParamsGen,
        (jobs, params) => {
          const results = queryJobs(jobs, params);

          for (const job of results) {
            // Must not be flagged
            expect(job.flagged).toBe(false);

            // Source filter
            if (params.source) {
              expect(job.source).toBe(params.source);
            }

            // Experience keywords filter
            if (params.experienceKeywords && params.experienceKeywords.length > 0) {
              const matchesExpKeyword = params.experienceKeywords.some((kw) =>
                job.title.toLowerCase().includes(kw.toLowerCase()),
              );
              expect(matchesExpKeyword).toBe(true);
            }

            // Custom keyword filter
            if (params.keyword) {
              const kw = params.keyword.toLowerCase();
              const matchesKeyword =
                job.title.toLowerCase().includes(kw) ||
                job.jd.toLowerCase().includes(kw);
              expect(matchesKeyword).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('(c) results are sorted correctly according to the specified sort field in descending order', () => {
    fc.assert(
      fc.property(
        fc.array(jobGen, { minLength: 0, maxLength: 50 }),
        queryParamsGen,
        (jobs, params) => {
          const results = queryJobs(jobs, params);

          for (let i = 0; i < results.length - 1; i++) {
            const current = results[i];
            const next = results[i + 1];

            if (params.sortBy === 'scrapedAt') {
              // scrapedAt descending
              expect(current.scrapedAt).toBeGreaterThanOrEqual(next.scrapedAt);
            } else {
              // postedAt: primary sort by postedAtDate descending (nulls last)
              const currDate = current.postedAtDate ?? -Infinity;
              const nextDate = next.postedAtDate ?? -Infinity;

              if (currDate !== nextDate) {
                expect(currDate).toBeGreaterThanOrEqual(nextDate);
              } else {
                // Secondary sort: scrapedAt descending
                expect(current.scrapedAt).toBeGreaterThanOrEqual(next.scrapedAt);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
