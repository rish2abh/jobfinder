/**
 * The data payload stored in BullMQ for a bulk mail job.
 *
 * File buffers cannot be stored in Redis directly, so the resume
 * is serialised as a base64 string and deserialised in the processor.
 */
export const MAIL_QUEUE = 'bulk-mail';

export const MAIL_JOB = 'send-bulk-mail';

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
