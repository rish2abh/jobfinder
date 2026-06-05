export const RESUME_QUEUE = 'resume-parse';
export const RESUME_JOB  = 'parse-resume';

/** Maximum number of Ollama call attempts before giving up */
export const LLM_MAX_ATTEMPTS = 3;

/**
 * Data stored in Redis for a resume-parse job.
 * The PDF buffer is stored as base64 so Redis can hold it.
 * rawText is stored here so the processor does not need to re-parse
 * the PDF if it is retrying only the LLM step.
 */
export interface ResumeParseJobData {
  userId: string;
  cloudinaryUrl: string;
  cloudinaryId: string;
  /** base64-encoded PDF buffer — used only if rawText is absent */
  pdfBase64?: string;
  /** Pre-extracted plain text from pdf-parse — stored so LLM can be retried later */
  rawText: string;
}

export interface ResumeParseJobResult {
  userId: string;
  cloudinaryUrl: string;
  rawText: string;
  parsedJson: Record<string, unknown>;
  /** How many LLM attempts were needed */
  llmAttempts: number;
}
