import { Injectable, Logger } from '@nestjs/common';
import { AgentTool } from './tool-registry';
import { GeminiFunctionDeclaration } from '../gemini-client.service';
import { DraftRepository } from '../drafts/draft.repository';

/**
 * Drafts follow-up or reply emails for recruiter conversations.
 * All replies are saved as drafts and require user approval.
 */
@Injectable()
export class ReplyDrafterService implements AgentTool {
  private readonly logger = new Logger(ReplyDrafterService.name);
  readonly name = 'draft_reply';

  readonly declaration: GeminiFunctionDeclaration = {
    name: 'draft_reply',
    description:
      'Draft a follow-up or reply email to a recruiter/contact. ' +
      'Creates a draft requiring user approval before sending. ' +
      'Useful for: following up on applications, thanking interviewers, ' +
      'responding to recruiter messages, or sending gentle reminders.',
    parameters: {
      type: 'object',
      properties: {
        recipientEmail: {
          type: 'string',
          description: 'Email to reply to',
        },
        recipientName: {
          type: 'string',
          description: 'Recipient name',
        },
        originalSubject: {
          type: 'string',
          description: 'Subject of the original email thread',
        },
        context: {
          type: 'string',
          description:
            'What to say (e.g. "follow up on my application from last week", ' +
            '"thank them for the interview", "ask about next steps")',
        },
        tone: {
          type: 'string',
          enum: ['professional', 'friendly', 'urgent', 'grateful'],
          description: 'Desired tone of the reply (default: professional)',
        },
        replyType: {
          type: 'string',
          enum: ['follow_up', 'thank_you', 'reminder', 'general'],
          description: 'Type of reply for template selection',
        },
      },
      required: ['recipientEmail', 'context'],
    },
  };

  constructor(private readonly draftRepo: DraftRepository) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId as string;
    const recipientEmail = args.recipientEmail as string;
    const recipientName = (args.recipientName as string) || '';
    const originalSubject = (args.originalSubject as string) || '';
    const context = (args.context as string) || '';
    const tone = (args.tone as string) || 'professional';

    // Build subject and body from context
    const subject = originalSubject
      ? `Re: ${originalSubject}`.slice(0, 200)
      : 'Follow up'.slice(0, 200);
    const body = context.slice(0, 2000) || `Hi ${recipientName || 'there'}, following up on our conversation.`;

    const draft = await this.draftRepo.create({
      userId,
      type: 'reply',
      status: 'pending',
      recipient: recipientEmail,
      subject,
      body,
      sourceThreadId: (args.sourceThreadId as string) || undefined,
      createdByRunId: (args.runId as string) || 'manual',
    });

    return {
      status: 'draft_created',
      draftId: draft._id.toString(),
      type: 'reply',
      recipient: recipientName || recipientEmail,
      message:
        `Reply draft created for ${recipientName || recipientEmail}. ` +
        'Review and approve in /agent/drafts before sending.',
    };
  }
}
