import { Logger } from '@nestjs/common';
import { Browser } from 'playwright';
import type { ScrapedRawJob } from '../job-scrape.types';
import {
  createContext,
  isCaptchaPage,
  randomDelay,
  safeGoto,
} from './browser.helper';

const logger = new Logger('JdFetcher');

/**
 * Fetches the full job description text for a list of jobs.
 * Only called for top-N keyword-matched results to minimise requests.
 * Mutates the passed jobs array in-place by setting .jd
 */
export async function fetchJdsForTopJobs(
  browser: Browser,
  jobs: ScrapedRawJob[],
): Promise<void> {
  if (jobs.length === 0) return;

  const context = await createContext(browser);
  const page    = await context.newPage();

  try {
    for (const job of jobs) {
      if (!job.applyUrl || job.flagged) continue;

      const loaded = await safeGoto(page, job.applyUrl, 15000);
      if (!loaded) {
        logger.warn(`JD fetch: could not load ${job.applyUrl}`);
        continue;
      }

      await randomDelay(1000, 2500);

      if (await isCaptchaPage(page)) {
        logger.warn(`JD fetch: CAPTCHA on ${job.applyUrl} — skipping JD only, job kept`);
        // Do NOT flag the job — it was scraped fine, we just couldn't fetch the full JD
        continue;
      }

      // Generic JD extraction — works across most job boards
      const jdText = await page.evaluate(() => {
        // Try known JD containers first
        const selectors = [
          '[data-testid="job-description"]',       // Indeed
          '.job-description',
          '#job-details',
          '.jd-desc',                               // Naukri
          '.job_description',
          '.description__text',                     // LinkedIn style
          'article',
          'main',
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 100) {
            return el.textContent.trim().slice(0, 5000); // cap at 5k chars
          }
        }
        return '';
      });

      if (jdText) {
        job.jd = jdText;
        logger.log(`JD fetched for "${job.title}" @ "${job.company}" (${jdText.length} chars)`);
      }
    }
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}
