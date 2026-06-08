import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Page } from 'playwright';
import { launchBrowser, createContext } from '../jobs/scraper/browser.helper';
import { ApplicationRepository } from './application.repository';
import { fillFormFields } from './form-filler';
import { detectBlocker, detectConfirmation } from './confirmation-detector';
import { WinstonLoggerService } from '../logger/winston-logger.service';
import {
  AUTO_APPLY_QUEUE,
  AutoApplyJobData,
  AutoApplyJobResult,
} from './auto-apply.types';

@Processor(AUTO_APPLY_QUEUE, { concurrency: 1 })
export class AutoApplyProcessor extends WorkerHost {
  private readonly context = 'AutoApplyProcessor';

  private static readonly PAGE_LOAD_TIMEOUT = 30000;
  private static readonly BLOCKER_DETECT_TIMEOUT = 10000;
  private static readonly BROWSER_RETRY_DELAY = 5000;

  constructor(
    private readonly applicationRepository: ApplicationRepository,
    private readonly logger: WinstonLoggerService,
  ) {
    super();
  }

  async process(job: Job<AutoApplyJobData, AutoApplyJobResult>): Promise<AutoApplyJobResult> {
    const { userId, jobId, applyUrl, profileData, resumeUrl, batchIndex, batchTotal } = job.data;
    const start = Date.now();

    this.logger.info('Job started', {
      context: this.context,
      jobId: job.id,
      userId,
      queue: AUTO_APPLY_QUEUE,
      targetJobId: jobId,
      batchIndex,
      batchTotal,
    });

    // Report progress for batch tracking
    if (batchTotal) {
      const progress = Math.round(((batchIndex ?? 0) / batchTotal) * 100);
      await job.updateProgress(progress);
    } else {
      await job.updateProgress(10);
    }

    // Extract platform from URL
    const platform = this.extractPlatform(applyUrl);

    // Launch browser with retry
    let browser;
    try {
      browser = await launchBrowser();
    } catch (err: any) {
      this.logger.warn(`Browser launch failed, retrying in 5s: ${err.message}`, this.context);
      await this.delay(AutoApplyProcessor.BROWSER_RETRY_DELAY);

      try {
        browser = await launchBrowser();
      } catch (retryErr: any) {
        const durationMs = Date.now() - start;
        const result: AutoApplyJobResult = {
          userId, jobId, status: 'failed',
          failureReason: `Browser launch failed: ${retryErr.message}`,
          platform, durationMs,
        };
        await this.applicationRepository.updateStatus(userId, jobId, {
          status: 'failed',
          failureReason: result.failureReason,
        });
        this.logger.errorWithMeta('Job failed', {
          context: this.context,
          jobId: job.id,
          userId,
          queue: AUTO_APPLY_QUEUE,
          durationMs,
          trace: retryErr?.stack || String(retryErr),
        });
        return result;
      }
    }

    try {
      const context = await createContext(browser);
      const page = await context.newPage();

      await job.updateProgress(20);

      // Navigate to the apply URL
      try {
        await page.goto(applyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: AutoApplyProcessor.PAGE_LOAD_TIMEOUT,
        });
      } catch (navErr: any) {
        const result: AutoApplyJobResult = {
          userId, jobId, status: 'failed',
          failureReason: `Navigation failed: ${navErr.message}`,
          platform, durationMs: Date.now() - start,
        };
        await this.applicationRepository.updateStatus(userId, jobId, {
          status: 'failed',
          failureReason: result.failureReason,
        });
        return result;
      }

      await job.updateProgress(35);

      // Detect CAPTCHA or login wall (abort within 10s)
      const blocker = await Promise.race([
        detectBlocker(page),
        this.delay(AutoApplyProcessor.BLOCKER_DETECT_TIMEOUT).then(() => null),
      ]);

      if (blocker) {
        this.logger.warn(`Blocker detected: ${blocker}`, this.context);
        const result: AutoApplyJobResult = {
          userId, jobId, status: 'requires_manual_action',
          failureReason: blocker,
          platform, durationMs: Date.now() - start,
        };
        await this.applicationRepository.updateStatus(userId, jobId, {
          status: 'requires_manual_action',
          failureReason: blocker,
        });
        return result;
      }

      await job.updateProgress(50);

      // Auto-fill form fields
      const fillResult = await fillFormFields(page, profileData, resumeUrl);

      this.logger.info(`Job progress: form fill — ${fillResult.filledCount} filled, ${fillResult.skippedFields.length} skipped`, {
        context: this.context,
        jobId: job.id,
        userId,
        queue: AUTO_APPLY_QUEUE,
      });

      await job.updateProgress(70);

      // Try to submit the form
      const originalUrl = page.url();
      const submitted = await this.trySubmitForm(page);

      if (!submitted) {
        const result: AutoApplyJobResult = {
          userId, jobId, status: 'requires_manual_action',
          failureReason: 'unsupported_form',
          skippedFields: fillResult.skippedFields,
          platform, durationMs: Date.now() - start,
        };
        await this.applicationRepository.updateStatus(userId, jobId, {
          status: 'requires_manual_action',
          failureReason: 'unsupported_form',
          skippedFields: fillResult.skippedFields,
        });
        return result;
      }

      await job.updateProgress(85);

      // Detect confirmation
      const confirmation = await detectConfirmation(page, originalUrl);

      if (confirmation.confirmed) {
        const durationMs = Date.now() - start;
        this.logger.info('Job completed', {
          context: this.context,
          jobId: job.id,
          userId,
          queue: AUTO_APPLY_QUEUE,
          durationMs,
          status: 'applied',
          confirmationMethod: confirmation.method,
        });
        const result: AutoApplyJobResult = {
          userId, jobId, status: 'applied',
          skippedFields: fillResult.skippedFields,
          platform, durationMs: Date.now() - start,
        };
        await this.applicationRepository.updateStatus(userId, jobId, {
          status: 'applied',
          appliedAt: new Date(),
          skippedFields: fillResult.skippedFields,
        });
        await job.updateProgress(100);
        return result;
      }

      // Could not confirm — mark as requires manual action
      const durationMs = Date.now() - start;
      this.logger.info('Job completed', {
        context: this.context,
        jobId: job.id,
        userId,
        queue: AUTO_APPLY_QUEUE,
        durationMs,
        status: 'requires_manual_action',
      });
      const result: AutoApplyJobResult = {
        userId, jobId, status: 'requires_manual_action',
        failureReason: 'confirmation_not_detected',
        skippedFields: fillResult.skippedFields,
        platform, durationMs,
      };
      await this.applicationRepository.updateStatus(userId, jobId, {
        status: 'requires_manual_action',
        failureReason: 'confirmation_not_detected',
        skippedFields: fillResult.skippedFields,
      });
      await job.updateProgress(100);
      return result;

    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Try to find and click a submit button on the page.
   */
  private async trySubmitForm(page: Page): Promise<boolean> {
    // Look for submit buttons in priority order
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Apply")',
      'button:has-text("Submit")',
      'button:has-text("Send")',
      'a:has-text("Apply")',
    ];

    for (const selector of submitSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            await button.click();
            // Wait for navigation or DOM change
            await page.waitForTimeout(2000);
            return true;
          }
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * Extract platform name from the apply URL.
   */
  private extractPlatform(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes('indeed')) return 'indeed';
      if (hostname.includes('naukri')) return 'naukri';
      if (hostname.includes('internshala')) return 'internshala';
      if (hostname.includes('linkedin')) return 'linkedin';
      if (hostname.includes('glassdoor')) return 'glassdoor';
      if (hostname.includes('monster')) return 'monster';
      return hostname.split('.').slice(-2, -1)[0] || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
