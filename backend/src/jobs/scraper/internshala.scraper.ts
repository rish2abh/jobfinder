import { Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import type { ScrapedRawJob } from '../job-scrape.types';
import {
  createContext,
  isCaptchaPage,
  randomDelay,
  safeGoto,
} from './browser.helper';

const logger = new Logger('IntershalaScraper');
const MAX_PAGES = 3;

/**
 * Scrapes Internshala job/internship listings.
 * Good for Indian market, entry-level and fresher roles.
 * Relatively low bot detection.
 *
 * ⚠️  Internshala's ToS prohibits automated scraping. Personal/MVP use only.
 */
export async function scrapeInternshala(
  browser: Browser,
  query: string,
  maxResults = 30,
): Promise<ScrapedRawJob[]> {
  const context = await createContext(browser);
  const page    = await context.newPage();
  const results: ScrapedRawJob[] = [];

  const querySlug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  try {
    for (let pageNum = 1; pageNum <= MAX_PAGES && results.length < maxResults; pageNum++) {
      const pagePart = pageNum > 1 ? `/page-${pageNum}` : '';
      const url = `https://internshala.com/jobs/${querySlug}-jobs${pagePart}`;

      logger.log(`Internshala page ${pageNum}: ${url}`);

      const loaded = await safeGoto(page, url);
      if (!loaded) {
        logger.warn(`Internshala: failed to load page ${pageNum}`);
        break;
      }

      await randomDelay(1500, 4000);

      if (await isCaptchaPage(page)) {
        logger.warn('Internshala: bot-wall detected — stopping');
        break;
      }

      // Wait for job cards to render
      await page.waitForSelector('.individual_internship, .job-internship-card', { timeout: 8000 })
        .catch(() => undefined);

      const jobs = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('.individual_internship, .job-internship-card'),
        );

        return cards.map((card) => {
          const titleEl    = card.querySelector('.job-title-href, h3.job-internship-name a, .profile a');
          const companyEl  = card.querySelector('.company-name, .link_display_like_text, p.company-name');
          const locationEl = card.querySelector('.location_link, .locations span, .location');
          const dateEl     = card.querySelector('.status-container .status, .posted_by_container');
          const linkEl     = (card.querySelector('a.job-title-href, h3 a') as HTMLAnchorElement) ?? null;

          return {
            title:    titleEl?.textContent?.trim()    ?? '',
            company:  companyEl?.textContent?.trim()  ?? '',
            location: locationEl?.textContent?.trim() ?? '',
            postedAt: dateEl?.textContent?.trim()     ?? '',
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
          source:    'internshala',
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

  logger.log(`Internshala: scraped ${results.length} jobs for "${query}"`);
  return results;
}
