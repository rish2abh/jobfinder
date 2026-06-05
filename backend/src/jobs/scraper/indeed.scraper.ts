import { Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import type { ScrapedRawJob } from '../job-scrape.types';
import {
  createContext,
  isCaptchaPage,
  randomDelay,
  safeGoto,
} from './browser.helper';

const logger = new Logger('IndeedScraper');

/** Max pages to scrape per query (10 results / page) */
const MAX_PAGES = 3;

/**
 * Scrapes Indeed job search results for a given query.
 * Only hits the search results page — never navigates to individual listings.
 *
 * ⚠️  Indeed's ToS prohibits automated scraping. Personal/MVP use only.
 */
export async function scrapeIndeed(
  browser: Browser,
  query: string,
  location = '',
  maxResults = 30,
): Promise<ScrapedRawJob[]> {
  const context = await createContext(browser);
  const page    = await context.newPage();
  const results: ScrapedRawJob[] = [];

  try {
    for (let pageNum = 0; pageNum < MAX_PAGES && results.length < maxResults; pageNum++) {
      const start = pageNum * 10;
      const encodedQuery    = encodeURIComponent(query);
      const encodedLocation = encodeURIComponent(location || 'Remote');
      const url = `https://www.indeed.com/jobs?q=${encodedQuery}&l=${encodedLocation}&start=${start}`;

      logger.log(`Indeed page ${pageNum + 1}: ${url}`);

      const loaded = await safeGoto(page, url);
      if (!loaded) {
        logger.warn(`Indeed: failed to load page ${pageNum + 1}`);
        break;
      }

      await randomDelay();

      if (await isCaptchaPage(page)) {
        logger.warn('Indeed: CAPTCHA detected — stopping scrape');
        // Return what we have with a flag on the last entry
        if (results.length > 0) {
          results[results.length - 1].flagged = true;
          results[results.length - 1].flagReason = 'captcha_detected';
        }
        break;
      }

      // Extract job cards from Indeed's search results DOM
      const jobs = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('[data-jk], .job_seen_beacon, .resultContent'),
        );

        return cards.map((card) => {
          const titleEl   = card.querySelector('[data-testid="job-title"] span, .jobTitle span, h2 a span');
          const companyEl = card.querySelector('[data-testid="company-name"], .companyName');
          const locationEl = card.querySelector('[data-testid="text-location"], .companyLocation');
          const dateEl    = card.querySelector('[data-testid="myJobsStateDate"], .date');
          const linkEl    = card.querySelector('h2 a, a.jcs-JobTitle') as HTMLAnchorElement | null;

          const title   = titleEl?.textContent?.trim()   ?? '';
          const company = companyEl?.textContent?.trim() ?? '';
          const location = locationEl?.textContent?.trim() ?? '';
          const postedAt = dateEl?.textContent?.trim() ?? '';
          const href    = linkEl?.getAttribute('href') ?? '';

          return { title, company, location, postedAt, href };
        }).filter((j) => j.title && j.company);
      });

      for (const j of jobs) {
        const applyUrl = j.href
          ? j.href.startsWith('http')
            ? j.href
            : `https://www.indeed.com${j.href}`
          : undefined;

        results.push({
          title:     j.title,
          company:   j.company,
          location:  j.location || undefined,
          postedAt:  j.postedAt || undefined,
          applyUrl,
          scrapeUrl: page.url(),
          source:    'indeed',
        });

        if (results.length >= maxResults) break;
      }

      if (jobs.length === 0) break; // No more results
      await randomDelay();
    }
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }

  logger.log(`Indeed: scraped ${results.length} jobs for query "${query}"`);
  return results;
}
