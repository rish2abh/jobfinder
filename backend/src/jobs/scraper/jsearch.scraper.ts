import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { ScrapedRawJob } from '../job-scrape.types';

const logger = new Logger('JSearchScraper');

/**
 * Seeds job results using the JSearch API (RapidAPI free tier — 200 req/month).
 * Used as a high-quality seed source when API key is configured.
 * Falls back gracefully if the key is not set or quota is exhausted.
 *
 * https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
 */
export async function scrapeJSearch(
  apiKey: string,
  query: string,
  maxResults = 20,
): Promise<ScrapedRawJob[]> {
  if (!apiKey) {
    logger.log('JSearch API key not configured — skipping JSearch source');
    return [];
  }

  const results: ScrapedRawJob[] = [];
  const pages = Math.min(Math.ceil(maxResults / 10), 3);

  for (let page = 1; page <= pages; page++) {
    const startTime = Date.now();
    try {
      const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
        params: {
          query,
          page: String(page),
          num_pages: '1',
          date_posted: 'week',
        },
        headers: {
          'x-rapidapi-key':  apiKey,
          'x-rapidapi-host': 'jsearch.p.rapidapi.com',
        },
        timeout: 10000,
      });

      const elapsed = Date.now() - startTime;
      logger.log(
        `[Scraper] JSearch API — success — elapsed: ${elapsed}ms, status: ${response.status}, page: ${page}`,
      );

      const data = response.data?.data;
      if (!Array.isArray(data) || data.length === 0) break;

      for (const item of data) {
        if (results.length >= maxResults) break;

        results.push({
          title:    item.job_title         ?? '',
          company:  item.employer_name     ?? '',
          location: item.job_city
            ? `${item.job_city}${item.job_state ? ', ' + item.job_state : ''}`
            : item.job_country ?? '',
          postedAt:  item.job_posted_at_datetime_utc ?? '',
          applyUrl:  item.job_apply_link   ?? item.job_google_link ?? '',
          scrapeUrl: item.job_google_link  ?? '',
          jd:        item.job_description  ?? '',
          source:    'jsearch',
        });
      }
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const status = err?.response?.status;
      logger.error(
        `[Scraper] JSearch API — failed — elapsed: ${elapsed}ms` +
        `${status ? `, status: ${status}` : ''}, page: ${page}, error: ${err?.message}`,
        err?.stack,
      );
      if (status === 429) {
        logger.warn('JSearch: rate limit hit — stopping');
        break;
      }
      if (status === 403) {
        logger.warn('JSearch: invalid API key or quota exhausted');
        break;
      }
      break;
    }
  }

  logger.log(`JSearch: fetched ${results.length} jobs for "${query}"`);
  return results;
}
