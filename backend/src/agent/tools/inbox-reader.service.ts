import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { AgentTool } from './tool-registry';
import { GeminiFunctionDeclaration, GeminiClientService } from '../gemini-client.service';
import { DraftRepository } from '../drafts/draft.repository';
import { ProcessedThreadRepository } from './processed-thread.repository';
import { MailService } from '../../mail/mail.service';

interface ParsedMessage {
  uid: number;
  threadId: string;
  from: string;
  subject: string;
  date: Date | null;
  textBody: string;
}

interface ClassifyResult {
  category: 'recruiter_reply' | 'rejection' | 'interview_invite' | 'spam' | 'other';
  confidence: number;
  summary: string;
  shouldReply: boolean;
}

/**
 * Reads inbox via IMAP (imapflow + mailparser), classifies emails using Gemini,
 * and drafts replies for recruiter messages.
 *
 * IMPORTANT: Does NOT mark IMAP messages as \Seen — this preserves the user's
 * unread state in their own mail client. Instead, tracks processed threads in
 * the processed_threads collection to avoid re-processing.
 */
@Injectable()
export class InboxReaderService implements AgentTool {
  private readonly logger = new Logger(InboxReaderService.name);
  readonly name = 'inbox';

  readonly declaration: GeminiFunctionDeclaration = {
    name: 'inbox',
    description:
      'Check email inbox: view sending history/stats, poll for new recruiter replies via IMAP, ' +
      'classify incoming emails, and auto-draft reply suggestions.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['history', 'stats', 'job_status', 'poll_replies'],
          description:
            'history = past mail jobs; stats = aggregate counts; ' +
            'job_status = specific job; poll_replies = fetch & classify new emails',
        },
        jobId: {
          type: 'string',
          description: 'Mail job ID (job_status action)',
        },
        limit: {
          type: 'number',
          description: 'Max messages to fetch (poll_replies, default 20)',
        },
      },
      required: ['action'],
    },
  };

  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly geminiClient: GeminiClientService,
    private readonly draftRepo: DraftRepository,
    private readonly processedThreadRepo: ProcessedThreadRepository,
  ) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId as string;
    const action = args.action as string;

    switch (action) {
      case 'history':
        return this.mailService.getJobsForUser(userId);

      case 'stats':
        return this.mailService.getStatsForUser(userId);

      case 'job_status': {
        const jobId = args.jobId as string;
        if (!jobId) return { error: 'jobId is required for job_status' };
        return this.mailService.getJobStatus(jobId);
      }

      case 'poll_replies':
        return this.pollReplies(userId, args);

      default:
        return { error: `Unknown inbox action: ${action}` };
    }
  }

  // ── IMAP polling + classification ──────────────────────────────────────────

  private async pollReplies(userId: string, args: Record<string, unknown>) {
    const limit = (args.limit as number) || 20;
    const runId = (args.runId as string) || 'manual';

    const imapHost = this.configService.get<string>('IMAP_HOST');
    const imapPort = this.configService.get<number>('IMAP_PORT', 993);
    const imapUser = this.configService.get<string>('IMAP_USER');
    const imapPass = this.configService.get<string>('IMAP_PASS');

    if (!imapHost || !imapUser || !imapPass) {
      return {
        status: 'not_configured',
        message: 'IMAP credentials not configured. Set IMAP_HOST, IMAP_USER, IMAP_PASS in .env.',
      };
    }

    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      auth: { user: imapUser, pass: imapPass },
      logger: false,
    });

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        return await this.fetchAndClassify(client, userId, limit, runId);
      } finally {
        lock.release();
      }
    } catch (err: any) {
      this.logger.error(`IMAP connection failed: ${err.message}`, err.stack);
      return { status: 'error', message: `IMAP error: ${err.message}` };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  private async fetchAndClassify(
    client: ImapFlow,
    userId: string,
    limit: number,
    runId: string,
  ) {
    // Fetch unseen messages (do NOT add \Seen flag)
    const messages: ParsedMessage[] = [];

    // Search for unseen messages
    const uids = await client.search({ seen: false }, { uid: true });

    if (!uids || uids.length === 0) {
      return { status: 'no_new_messages', messages: [], classified: 0, draftsCreated: 0 };
    }

    // Limit the number of messages to process
    const targetUids = uids.slice(0, limit);

    // Filter out already processed threads
    const threadIds = targetUids.map((uid) => `${userId}:${uid}`);
    const alreadyProcessed = await this.processedThreadRepo.findProcessed(userId, threadIds);

    const unprocessedUids = targetUids.filter(
      (uid) => !alreadyProcessed.has(`${userId}:${uid}`),
    );

    if (unprocessedUids.length === 0) {
      return { status: 'all_processed', messages: [], classified: 0, draftsCreated: 0 };
    }

    // Fetch message content without marking as seen
    for (const uid of unprocessedUids) {
      try {
        const msg = await client.fetchOne(String(uid), {
          source: true,
          uid: true,
        }, { uid: true });

        if (!msg || !msg.source) continue;

        let parsed: ParsedMail;
        try {
          parsed = await simpleParser(msg.source);
        } catch (parseErr: any) {
          this.logger.warn(`Failed to parse message UID ${uid}: ${parseErr.message}`);
          // Mark as processed anyway so we don't retry a malformed email
          await this.processedThreadRepo.markProcessed(userId, `${userId}:${uid}`);
          continue;
        }

        messages.push({
          uid,
          threadId: `${userId}:${uid}`,
          from: parsed.from?.text || 'unknown',
          subject: parsed.subject || '(no subject)',
          date: parsed.date || null,
          textBody: (parsed.text || '').slice(0, 2000),
        });
      } catch (fetchErr: any) {
        this.logger.warn(`Failed to fetch UID ${uid}: ${fetchErr.message}`);
      }
    }

    if (messages.length === 0) {
      return { status: 'no_parseable_messages', messages: [], classified: 0, draftsCreated: 0 };
    }

    // Classify each message and optionally draft replies
    const results: Array<{ uid: number; from: string; subject: string; classification: ClassifyResult; draftId?: string }> = [];
    let draftsCreated = 0;

    for (const msg of messages) {
      try {
        const classification = await this.classifyEmail(msg);

        // Mark thread as processed regardless of classification outcome
        await this.processedThreadRepo.markProcessed(userId, msg.threadId);

        let draftId: string | undefined;

        if (classification.shouldReply) {
          draftId = await this.draftReply(userId, msg, classification, runId);
          if (draftId) draftsCreated++;
        }

        results.push({
          uid: msg.uid,
          from: msg.from,
          subject: msg.subject,
          classification,
          draftId,
        });
      } catch (classifyErr: any) {
        this.logger.warn(`Failed to classify UID ${msg.uid}: ${classifyErr.message}`);
        // Still mark as processed to avoid infinite retries
        await this.processedThreadRepo.markProcessed(userId, msg.threadId);
      }
    }

    return {
      status: 'completed',
      messages: results,
      classified: results.length,
      draftsCreated,
    };
  }

  // ── Gemini classify_email ──────────────────────────────────────────────────

  private async classifyEmail(msg: ParsedMessage): Promise<ClassifyResult> {
    const prompt = [
      'Classify this email into one of: recruiter_reply, rejection, interview_invite, spam, other.',
      'Respond with ONLY valid JSON matching this schema:',
      '{"category":"...","confidence":0.0-1.0,"summary":"one sentence","shouldReply":true/false}',
      '',
      `From: ${msg.from}`,
      `Subject: ${msg.subject}`,
      `Date: ${msg.date?.toISOString() ?? 'unknown'}`,
      '',
      msg.textBody.slice(0, 1500),
    ].join('\n');

    const response = await this.geminiClient.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      'You are an email classification assistant. Respond only with valid JSON, no markdown.',
      [],
    );

    const text = (response.text ?? '').trim();
    const parsed = this.parseJsonResponse<ClassifyResult>(text);

    // Validate required fields
    if (!parsed || !parsed.category) {
      return {
        category: 'other',
        confidence: 0,
        summary: 'Failed to classify',
        shouldReply: false,
      };
    }

    const validCategories = ['recruiter_reply', 'rejection', 'interview_invite', 'spam', 'other'];
    if (!validCategories.includes(parsed.category)) {
      parsed.category = 'other';
    }

    parsed.confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
    parsed.shouldReply = Boolean(parsed.shouldReply);
    parsed.summary = String(parsed.summary || '').slice(0, 500);

    return parsed;
  }

  // ── Gemini draft_reply ─────────────────────────────────────────────────────

  private async draftReply(
    userId: string,
    msg: ParsedMessage,
    classification: ClassifyResult,
    runId: string,
  ): Promise<string | undefined> {
    const prompt = [
      'Draft a professional reply to this email. Keep it concise (under 150 words).',
      'Respond with ONLY valid JSON matching this schema:',
      '{"subject":"Re: ...","body":"<html body>"}',
      '',
      `Classification: ${classification.category} — ${classification.summary}`,
      `From: ${msg.from}`,
      `Subject: ${msg.subject}`,
      '',
      msg.textBody.slice(0, 1500),
    ].join('\n');

    const response = await this.geminiClient.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      'You are an email reply assistant for a job seeker. Write helpful, professional replies. Respond only with valid JSON, no markdown.',
      [],
    );

    const text = (response.text ?? '').trim();
    const parsed = this.parseJsonResponse<{ subject: string; body: string }>(text);

    if (!parsed?.subject || !parsed?.body) {
      this.logger.warn(`Failed to generate reply for UID ${msg.uid}`);
      return undefined;
    }

    const draft = await this.draftRepo.create({
      userId,
      type: 'reply',
      status: 'pending',
      recipient: msg.from,
      subject: parsed.subject.slice(0, 200),
      body: parsed.body.slice(0, 2000),
      sourceThreadId: msg.threadId,
      createdByRunId: runId,
    });

    return draft._id.toString();
  }

  // ── JSON parsing helper ────────────────────────────────────────────────────

  private parseJsonResponse<T>(text: string): T | null {
    // Strip markdown code fences if present
    let cleaned = text;
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try to extract JSON from within the text
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
