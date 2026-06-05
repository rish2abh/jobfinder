import { Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import type { ScrapedRawJob } from '../job-scrape.types';
import {
  createContext,
  isCaptchaPage,
  randomDelay,
  safeGoto,
} from './browser.helper';

const logger = new Logger('NaukriScraper');
const MAX_PAGES = 3;

/**
 * Scrapes Naukri.com job search results.
 * Good signal for Indian job market — relatively low bot detection.
 *
 * ⚠️  Naukri's ToS prohibits automated scraping. Personal/MVP use only.
 */
export async function scrapeNaukri(
  browser: Browser,
  query: string,
  location = '',
  maxResults = 30,
): Promise<ScrapedRawJob[]> {
  const context = await createContext(browser);
  const page    = await context.newPage();
  const results: ScrapedRawJob[] = [];

  // Naukri slug format: "node-js-react-jobs" or "node-js-jobs-in-bangalore"
  const querySlug    = query.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const locationSlug = location ? location.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';

  try {
    for (let pageNum = 1; pageNum <= MAX_PAGES && results.length < maxResults; pageNum++) {
      const locPart = locationSlug ? `-in-${locationSlug}` : '';
      const pagePart = pageNum > 1 ? `-${pageNum}` : '';
      const url = `https://www.naukri.com/${querySlug}${locPart}-jobs${pagePart}`;

      logger.log(`Naukri page ${pageNum}: ${url}`);

      const loaded = await safeGoto(page, url);
      if (!loaded) {
        logger.warn(`Naukri: failed to load page ${pageNum}`);
        break;
      }

      await randomDelay();

      if (await isCaptchaPage(page)) {
        logger.warn('Naukri: CAPTCHA / bot-wall detected — stopping');
        break;
      }

      const jobs = await page.evaluate(() => {
        // Naukri article-based job card selectors
        const cards = Array.from(
          document.querySelectorAll('article.jobTuple, .srp-jobtuple-wrapper, [data-job-id]'),
        );

        return cards.map((card) => {
          const titleEl    = card.querySelector('a.title, .row1 a.title, [class*="title"] a');
          const companyEl  = card.querySelector('.companyInfo a, .company-name, [class*="company"] a');
          const locationEl = card.querySelector('.location span, [class*="location"], li.location');
          const dateEl     = card.querySelector('.job-post-day, .freshness, [class*="date"]');
          const linkEl     = (card.querySelector('a.title, .row1 a') as HTMLAnchorElement) ?? null;

          return {
            title:    titleEl?.textContent?.trim()   ?? '',
            company:  companyEl?.textContent?.trim() ?? '',
            location: locationEl?.textContent?.trim() ?? '',
            postedAt: dateEl?.textContent?.trim() ?? '',
            href:     linkEl?.href ?? '',
          };
        }).filter((j) => j.title && j.company);
      });

      for (const j of jobs) {
        results.push({
          title:     j.title,
          company:   j.company,
          location:  j.location || undefined,
          postedAt:  j.postedAt || undefined,
          applyUrl:  j.href || undefined,
          scrapeUrl: url,
          source:    'naukri',
        });
        if (results.length >= maxResults) break;
      }

      if (jobs.length === 0) break;
      await randomDelay();
    }
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }

  logger.log(`Naukri: scraped ${results.length} jobs for "${query}"`);
  return results;
}
