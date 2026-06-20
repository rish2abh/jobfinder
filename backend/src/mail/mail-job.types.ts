/**
 * The data payload stored in BullMQ for a bulk mail job.
 *
 * File buffers cannot be stored in Redis directly, so the resume
 * is serialised as a base64 string and deserialised in the processor.
 */
export const MAIL_QUEUE = 'bulk-mail';

export const MAIL_JOB = 'send-bulk-mail';

export const TEMPLATE_MAIL_JOB = 'send-template-email';

export interface BulkMailJobData {
  subject: string;
  context: string;
  mailIds: string[];
  from?: string;
  fromTtlSeconds?: string;

  // One of these two must be present
  userId?: string;

  // When resume was uploaded as a file:
  resumeBase64?: string;       // base64-encoded PDF buffer
  resumeFilename?: string;     // original filename
  resumeMimetype?: string;
}

export interface BulkMailJobResult {
  message: string;
  sent: string[];
  failed: string[];
  sentCount: number;
  failedCount: number;
}

/**
 * Job data for sending a personalized template email to a single recipient.
 * One job per recipient is enqueued — rate limiting is handled at the queue level.
 */
export interface TemplateMailJobData {
  userId: string;
  bulkJobId: string;
  groupId: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  from?: string;
  resumeUrl?: string;          // Cloudinary URL for attachment
}

export interface TemplateMailJobResult {
  recipientEmail: string;
  status: 'sent' | 'failed';
  failureReason?: string;
}

/**
 * Job type for sending an approved agent draft (cold outreach or reply).
 * Unlike TEMPLATE_MAIL_JOB, this does NOT require a groupId — the result
 * is written back to the draft document instead of mailResultModel.
 */
export const AGENT_MAIL_JOB = 'send-agent-email';

export interface AgentMailJobData {
  draftId: string;
  userId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  resumeUrl?: string;
}

export interface AgentMailJobResult {
  draftId: string;
  recipientEmail: string;
  status: 'sent' | 'failed';
  failureReason?: string;
}
