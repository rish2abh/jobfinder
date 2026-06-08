import { Page } from 'playwright';

/** Patterns in the URL that indicate a successful submission */
const CONFIRMATION_URL_PATTERNS = [
  'thank',
  'success',
  'confirm',
  'applied',
  'submitted',
  'complete',
  'done',
];

/** DOM selectors that indicate success messages */
const SUCCESS_SELECTORS = [
  '[class*="success"]',
  '[class*="confirm"]',
  '[class*="thank"]',
  '[data-testid*="success"]',
  '[role="alert"]',
];

/** Text patterns in page content indicating successful submission */
const SUCCESS_TEXT_PATTERNS = [
  'thank you',
  'application submitted',
  'successfully applied',
  'application received',
  'we received your application',
  'application complete',
  'you have applied',
];

export interface ConfirmationResult {
  confirmed: boolean;
  method: 'url_change' | 'success_element' | 'success_text' | 'timeout';
  details?: string;
}

/**
 * Detect CAPTCHA or login wall on the page.
 * Returns a reason string if detected, null otherwise.
 */
export async function detectBlocker(page: Page): Promise<string | null> {
  const title = (await page.title()).toLowerCase();
  const url = page.url().toLowerCase();

  // CAPTCHA detection
  if (
    title.includes('captcha') ||
    title.includes('robot') ||
    title.includes('just a moment') ||
    url.includes('captcha') ||
    url.includes('cf-challenge')
  ) {
    return 'captcha_detected';
  }

  const hasCaptchaElement = await page.evaluate(() => {
    return !!(
      document.querySelector('#challenge-form') ||
      document.querySelector('.g-recaptcha') ||
      document.querySelector('[data-sitekey]') ||
      document.querySelector('iframe[src*="captcha"]') ||
      document.querySelector('iframe[src*="recaptcha"]')
    );
  });

  if (hasCaptchaElement) return 'captcha_detected';

  // Login wall detection
  const hasLoginWall = await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    const hasLoginForm = !!(
      document.querySelector('input[type="password"]') ||
      document.querySelector('[name="password"]')
    );
    const hasLoginText =
      text.includes('sign in to continue') ||
      text.includes('log in to apply') ||
      text.includes('create an account') ||
      text.includes('login required');

    return hasLoginForm && hasLoginText;
  });

  if (hasLoginWall) return 'login_required';

  return null;
}

/**
 * After form submission, detect if the application was submitted successfully.
 * Waits up to 10 seconds for confirmation signals.
 */
export async function detectConfirmation(
  page: Page,
  originalUrl: string,
  timeoutMs = 10000,
): Promise<ConfirmationResult> {
  const startTime = Date.now();

  // Wait a bit for page to process the submission
  await page.waitForTimeout(2000);

  // 1. Check URL change
  const currentUrl = page.url().toLowerCase();
  if (currentUrl !== originalUrl.toLowerCase()) {
    for (const pattern of CONFIRMATION_URL_PATTERNS) {
      if (currentUrl.includes(pattern)) {
        return { confirmed: true, method: 'url_change', details: currentUrl };
      }
    }
  }

  // 2. Check for success elements
  for (const selector of SUCCESS_SELECTORS) {
    const element = await page.$(selector);
    if (element) {
      const text = (await element.textContent()) ?? '';
      const lowerText = text.toLowerCase();
      for (const pattern of SUCCESS_TEXT_PATTERNS) {
        if (lowerText.includes(pattern)) {
          return { confirmed: true, method: 'success_element', details: text.slice(0, 100) };
        }
      }
    }
  }

  // 3. Check page body text for success patterns
  const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? '');
  for (const pattern of SUCCESS_TEXT_PATTERNS) {
    if (bodyText.includes(pattern)) {
      return { confirmed: true, method: 'success_text', details: pattern };
    }
  }

  // 4. Wait remaining time and re-check
  const elapsed = Date.now() - startTime;
  if (elapsed < timeoutMs) {
    await page.waitForTimeout(Math.min(4000, timeoutMs - elapsed));

    // Re-check URL
    const finalUrl = page.url().toLowerCase();
    if (finalUrl !== originalUrl.toLowerCase()) {
      for (const pattern of CONFIRMATION_URL_PATTERNS) {
        if (finalUrl.includes(pattern)) {
          return { confirmed: true, method: 'url_change', details: finalUrl };
        }
      }
    }

    // Re-check body text
    const finalBody = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? '');
    for (const pattern of SUCCESS_TEXT_PATTERNS) {
      if (finalBody.includes(pattern)) {
        return { confirmed: true, method: 'success_text', details: pattern };
      }
    }
  }

  return { confirmed: false, method: 'timeout' };
}
