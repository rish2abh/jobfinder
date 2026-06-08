import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Logger } from '@nestjs/common';
import { MIN_DELAY_MS, MAX_DELAY_MS } from '../job-scrape.types';

const logger = new Logger('BrowserHelper');

/**
 * A pool of realistic User-Agent strings for desktop Chrome.
 * Rotated randomly per scrape run.
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Random delay between MIN and MAX to mimic human pacing */
export function randomDelay(min = MIN_DELAY_MS, max = MAX_DELAY_MS): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/** Launch a stealth Chromium browser for scraping */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
}

/** Create a context with realistic headers, viewport, and locale */
export async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
    // Block images/fonts/media to speed up loads and reduce fingerprint
    // We still need CSS for DOM selection to work
  });
}

/**
 * CAPTCHA / bot-wall detection heuristics.
 * Returns true if the page looks like a challenge page rather than real content.
 */
export async function isCaptchaPage(page: Page): Promise<boolean> {
  const title = (await page.title()).toLowerCase();
  const url   = page.url().toLowerCase();

  const captchaSignals = [
    title.includes('captcha'),
    title.includes('robot'),
    title.includes('access denied'),
    title.includes('403'),
    title.includes('just a moment'),    // Cloudflare
    title.includes('security check'),
    url.includes('captcha'),
    url.includes('cf-challenge'),
    url.includes('challenge'),
  ];

  if (captchaSignals.some(Boolean)) return true;

  // Check for known challenge DOM patterns
  const hasChallengeElement = await page.evaluate(() => {
    return !!(
      document.querySelector('#challenge-form') ||        // Cloudflare
      document.querySelector('.g-recaptcha') ||            // reCAPTCHA
      document.querySelector('[data-sitekey]') ||          // hCaptcha / reCAPTCHA
      document.querySelector('iframe[src*="captcha"]')
    );
  });

  return hasChallengeElement;
}

/** Safe page.goto with timeout and error handling */
export async function safeGoto(
  page: Page,
  url: string,
  timeoutMs = 20000,
): Promise<boolean> {
  const startTime = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const elapsed = Date.now() - startTime;
    const status = response?.status() ?? 0;
    logger.log(
      `[Scraper] page.goto — success — elapsed: ${elapsed}ms, status: ${status}, url: ${url.slice(0, 120)}`,
    );
    return true;
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    logger.error(
      `[Scraper] page.goto — failed — elapsed: ${elapsed}ms, url: ${url.slice(0, 120)}, error: ${err.message}`,
      err.stack,
    );
    return false;
  }
}
