export const MATCHING_QUEUE = 'matching';

export const MATCHING_JOBS = {
  EMBED_PROFILE: 'embed-profile',
  EMBED_JOBS: 'embed-jobs',
  COMPUTE_SCORES: 'compute-scores',
} as const;

export interface EmbedProfileJobData {
  type: 'embed-profile';
  userId: string;
  /** Optional pre-built profile text; if omitted, processor fetches & builds it */
  profileText?: string;
  /** Optional metadata to store with the embedding */
  metadata?: Record<string, string | number | boolean>;
}

export interface EmbedJobsJobData {
  type: 'embed-jobs';
  jobIds: string[];
  /** Optional pre-built job embedding inputs; if omitted, processor fetches from DB */
  jobs?: Array<{ jobId: string; text: string; metadata?: Record<string, string | number | boolean> }>;
}

export interface ComputeScoresJobData {
  type: 'compute-scores';
  userId: string;
  jobIds: string[];
  /** Optional pre-fetched resume skills; if omitted, processor fetches from profile */
  resumeSkills?: string[];
}

export type MatchingJobData =
  | EmbedProfileJobData
  | EmbedJobsJobData
  | ComputeScoresJobData;

export interface MatchingJobResult {
  type: string;
  success: boolean;
  details?: Record<string, any>;
}
