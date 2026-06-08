export const AUTO_APPLY_QUEUE = 'auto-apply';
export const AUTO_APPLY_JOB = 'auto-apply-job';

export interface AutoApplyJobData {
  userId: string;
  jobId: string;
  applyUrl: string;
  profileData: {
    name: string;
    email: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  resumeUrl?: string;
  /** For batch jobs: current index (0-based) and total count */
  batchIndex?: number;
  batchTotal?: number;
}

export interface AutoApplyJobResult {
  userId: string;
  jobId: string;
  status: 'applied' | 'failed' | 'requires_manual_action';
  failureReason?: string;
  skippedFields?: SkippedField[];
  platform: string;
  durationMs: number;
}

export interface SkippedField {
  fieldIdentifier: string;
  reason: 'requires_manual_review';
}
