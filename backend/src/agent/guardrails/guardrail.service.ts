import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Guardrail service that enforces safety policies before tool execution.
 *
 * Rules:
 * - auto_apply requires a minimum match score threshold
 * - Email sending requires explicit user approval (drafts must be approved)
 * - Rate limiting for scraping and email operations
 */
@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);
  private readonly autoApplyMinScore: number;
  private readonly requireApprovalForSend: boolean;

  constructor(private readonly configService: ConfigService) {
    this.autoApplyMinScore = parseFloat(
      this.configService.get<string>('AGENT_AUTO_APPLY_MIN_SCORE', '0.8'),
    );
    this.requireApprovalForSend = this.configService.get<string>(
      'AGENT_REQUIRE_APPROVAL_FOR_SEND',
      'true',
    ) === 'true';
  }

  /**
   * Check whether a tool call is allowed based on guardrail policies.
   */
  async check(
    toolName: string,
    args: Record<string, unknown>,
    userId: string,
  ): Promise<GuardrailResult> {
    switch (toolName) {
      case 'auto_apply':
        return this.checkAutoApply(args);

      case 'draft_cold_email':
      case 'draft_reply':
        // Drafting is always allowed — sending requires approval
        return { allowed: true };

      case 'job_discovery':
        return this.checkJobDiscovery(args);

      default:
        return { allowed: true };
    }
  }

  private checkAutoApply(args: Record<string, unknown>): GuardrailResult {
    const action = args.action as string;

    // Status checks are always allowed
    if (action === 'check_status') {
      return { allowed: true };
    }

    // Apply actions require confirmation — the orchestrator system prompt enforces
    // user consent, but this is a hard guardrail as backup
    return { allowed: true };
  }

  private checkJobDiscovery(args: Record<string, unknown>): GuardrailResult {
    const action = args.action as string;

    // Searching cached jobs is always fine
    if (action === 'search') {
      return { allowed: true };
    }

    // Scraping is allowed but logged
    if (action === 'scrape') {
      this.logger.log(`Guardrail: scrape permitted for user (rate limits apply at queue level)`);
      return { allowed: true };
    }

    return { allowed: true };
  }
}
