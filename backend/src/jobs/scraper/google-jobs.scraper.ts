import { Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import type { ScrapedRawJob } from '../job-scrape.types';
import {
  createContext,
  isCaptchaPage,
  randomDelay,
  safeGoto,
} from './browser.helper';
import { buildGoogleJobsUrl } from './query-builder';

const logger = new Logger('GoogleJobsScraper');

/**
 * Scrapes Google Jobs search results.
 *
 * Google Jobs (ibp=htl;jobs) renders structured job cards that include:
 *   - Job title, company, location, posted date
 *   - Multiple "Apply" links (company site, LinkedIn, Indeed, etc.)
 *   - Full job description in the side panel
 *
 * Advantage over other scrapers:
 *   - Aggregates from many sources in one request
 *   - Usually has a direct "Apply on company website" link
 *   - Lower CAPTCHA rate than Indeed/LinkedIn
 *   - Works for company-targeted searches: "React developer jobs at Google"
 *
 * ⚠️  Personal/MVP use only.
 */
export async function scrapeGoogleJobs(
  browser: Browser,
  query: string,
  targetCompany?: string,
  maxResults = 30,
): Promise<ScrapedRawJob[]> {
  const context = await createContext(browser);
  const page    = await context.newPage();
  const results: ScrapedRawJob[] = [];

  const url = buildGoogleJobsUrl(query);
  logger.log(`Google Jobs: ${url}`);

  try {
    const loaded = await safeGoto(page, url, 25000);
    if (!loaded) {
      logger.warn('Google Jobs: failed to load page');
      return results;
    }

    await randomDelay(2000, 3500);

    if (await isCaptchaPage(page)) {
      logger.warn('Google Jobs: CAPTCHA detected — skipping');
      return results;
    }

    // Wait for the job card list to appear
    await page
      .waitForSelector('[data-ved] li[data-ved], .iFjolb, .gws-plugins-horizon-jobs__li-ed', {
        timeout: 10000,
      })
      .catch(() => logger.warn('Google Jobs: job card selector timed out'));

    // Extract job cards from Google's job search DOM
    const rawJobs = await page.evaluate((maxR: number) => {
      const jobs: Array<{
        title: string;
        company: string;
        location: string;
        postedAt: string;
        jd: string;
        applyUrl: string;
        scrapeUrl: string;
      }> = [];

      // Google Jobs renders cards inside the jobs panel
      // Multiple possible selector patterns across Google's A/B tests
      const cardSelectors = [
        '.iFjolb',                                      // Standard Google Jobs card
        '.gws-plugins-horizon-jobs__li-ed',             // Horizon layout
        '[data-ved] li[data-ved]',                      // Generic nested list
        '.PwjeAc',                                      // Alternative layout
      ];

      let cards: Element[] = [];
      for (const sel of cardSelectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) { cards = found; break; }
      }

      for (const card of cards.slice(0, maxR)) {
        // Title
        const titleEl = card.querySelector(
          '.BjJfJf, .sH3zFd, h3, [class*="title"]',
        );
        const title = titleEl?.textContent?.trim() ?? '';
        if (!title) continue;

        // Company
        const companyEl = card.querySelector(
          '.vNEEBe, .company, [class*="company"]',
        );
        const company = companyEl?.textContent?.trim() ?? '';

        // Location
        const locationEl = card.querySelector('.Qk80Jf, .location, [class*="location"]');
        const location = locationEl?.textContent?.trim() ?? '';

        // Posted date
        const dateEl = card.querySelector('.SuWscb, [class*="date"], [class*="time"]');
        const postedAt = dateEl?.textContent?.trim() ?? '';

        // Apply URL — prefer company site link inside the card
        let applyUrl = '';
        const links = Array.from(card.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        for (const link of links) {
          const href = link.href ?? '';
          // Prefer links that go to company sites (not Google internal)
          if (href && !href.includes('google.com') && href.startsWith('http')) {
            applyUrl = href;
            break;
          }
        }
        // Fallback: use the card's own link
        if (!applyUrl) {
          const cardLink = card.querySelector('a') as HTMLAnchorElement | null;
          applyUrl = cardLink?.href ?? '';
        }

        // Job description — may be in an expanded details panel
        const jdEl = card.querySelector(
          '.HBvzbc, .job-description, [class*="description"]',
        );
        const jd = jdEl?.textContent?.trim().slice(0, 4000) ?? '';

        jobs.push({ title, company, location, postedAt, jd, applyUrl, scrapeUrl: window.location.href });
      }
      return jobs;
    }, maxResults);

    for (const j of rawJobs) {
      if (!j.title) continue;
      results.push({
        title:         j.title,
        company:       j.company || targetCompany || 'Unknown',
        location:      j.location  || undefined,
        postedAt:      j.postedAt  || undefined,
        applyUrl:      j.applyUrl  || undefined,
        scrapeUrl:     j.scrapeUrl || url,
        jd:            j.jd        || undefined,
        source:        'google',
        targetCompany: targetCompany || undefined,
      });
    }

    // If Google Jobs panel didn't render cards, try clicking the first card
    // to expand the detail panel and scrape from there
    if (results.length === 0) {
      logger.warn('Google Jobs: no cards found with primary selectors — trying fallback');

      const fallbackCards = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('li[data-ved], .nJXhWb'));
        return items.slice(0, 20).map((el) => ({
          text: el.textContent?.trim().slice(0, 200) ?? '',
          href: (el.querySelector('a') as HTMLAnchorElement)?.href ?? '',
        }));
      });

      for (const fc of fallbackCards) {
        if (!fc.text || !fc.href) continue;
        const lines = fc.text.split('\n').map((l) => l.trim()).filter(Boolean);
        results.push({
          title:        lines[0] ?? 'Unknown',
          company:      lines[1] ?? targetCompany ?? 'Unknown',
          location:     lines[2] || undefined,
          applyUrl:     fc.href,
          scrapeUrl:    url,
          source:       'google',
          targetCompany: targetCompany || undefined,
        });
      }
    }

  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }

  logger.log(`Google Jobs: scraped ${results.length} jobs for "${query}"`);
  return results;
}
