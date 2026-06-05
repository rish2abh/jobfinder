import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: 'http://localhost:3000',
  timeout: 30000,
});

// Request interceptor
api.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
);

// Response interceptor for global error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred';

    // Don't auto-toast for 404 on resume (user may not have uploaded yet)
    const isResumeNotFound =
      error.response?.status === 404 &&
      error.config?.url?.includes('/resume');

    if (!isResumeNotFound) {
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }

    return Promise.reject(error);
  }
);

// ── Users ──────────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  name: string;
  email: string;
}

export interface User {
  _id: string;
  name: string;
  email: string;
  resume?: Record<string, unknown>;
  resumeRawText?: string;
  resumeCloudinaryUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResumeData {
  resume: Record<string, unknown>;
  rawText: string;
  cloudinaryUrl: string;
}

export const createUser = (data: CreateUserPayload) =>
  api.post<User>('/users', data).then((r) => r.data);

export const getUserById = (id: string) =>
  api.get<User>(`/users/${id}`).then((r) => r.data);

export const getUserByEmail = (email: string) =>
  api.get<User>(`/users/by-email/${encodeURIComponent(email)}`).then((r) => r.data);

export const getUserResume = (id: string) =>
  api.get<ResumeData>(`/users/${id}/resume`).then((r) => r.data);

// ── Profile ────────────────────────────────────────────────────────────────

export interface ExperienceItem {
  company?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface EducationItem {
  institution?: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

export interface ProjectItem {
  name?: string;
  description?: string;
  technologies?: string[];
}

export interface UserProfile {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  headline?: string;
  bio?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  skills?: string[];
  experience?: ExperienceItem[];
  education?: EducationItem[];
  certifications?: string[];
  languages?: string[];
  projects?: ProjectItem[];
  lastUpdatedFrom?: 'resume_parse' | 'raw_text_extract' | 'manual';
  updatedAt?: string;
}

export type UpdateProfilePayload = Partial<UserProfile>;

export const getUserProfile = (id: string) =>
  api.get<UserProfile>(`/users/${id}/profile`).then((r) => r.data);

export const updateUserProfile = (id: string, data: UpdateProfilePayload) =>
  api.patch<User>(`/users/${id}/profile`, data).then((r) => r.data);

export const extractProfileFromResume = (id: string) =>
  api.post<UserProfile>(`/users/${id}/profile/extract`).then((r) => r.data);

// ── Uploads ────────────────────────────────────────────────────────────────

export interface UploadResumePayload {
  userId: string;
  file: File;
  onUploadProgress?: (percent: number) => void;
}

export const uploadResume = ({ userId, file, onUploadProgress }: UploadResumePayload) => {
  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('file', file);

  return api
    .post<UploadEnqueueResult>('/uploads/resume', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (event.total) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onUploadProgress?.(percent);
        }
      },
    })
    .then((r) => r.data);
};

// ── Mail ───────────────────────────────────────────────────────────────────

export interface SendBulkMailPayload {
  subject: string;
  context: string;
  mailIds: string[];
  userId?: string;
  resume?: File | null;
}

export interface BulkMailResult {
  message?: string;
  sent?: string[];
  failed?: string[];
  sentCount?: number;
  failedCount?: number;
}

// Response from POST /mail/bulk — job is now queued asynchronously
export interface BulkMailEnqueueResult {
  jobId: string;
  status: 'queued';
}

// Response from GET /mail/bulk/status/:jobId
export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused' | 'unknown';

export interface BulkMailJobStatus {
  jobId: string;
  state: JobState;
  progress: number;
  result: BulkMailResult | null;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: number;
}

export const sendBulkMail = (payload: SendBulkMailPayload) => {
  const formData = new FormData();
  formData.append('subject', payload.subject);
  formData.append('context', payload.context);
  // Backend accepts comma-separated string for mailIds in form-data
  formData.append('mailIds', payload.mailIds.join(','));

  if (payload.userId) {
    formData.append('userId', payload.userId);
  }
  if (payload.resume) {
    formData.append('resume', payload.resume);
  }

  return api
    .post<BulkMailEnqueueResult>('/mail/bulk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data);
};

export const getBulkMailJobStatus = (jobId: string) =>
  api.get<BulkMailJobStatus>(`/mail/bulk/status/${jobId}`).then((r) => r.data);

// ── Mail History & Stats ───────────────────────────────────────────────────

export interface MailJobSummary {
  jobId: string;
  state: JobState;
  subject: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  timestamp: number;
  result: BulkMailResult | null;
  failedReason: string | null;
}

export interface MailStats {
  totalJobs: number;
  totalSent: number;
  totalFailed: number;
  totalRecipients: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
}

export const getMailHistory = (userId: string) =>
  api.get<MailJobSummary[]>(`/mail/history/${userId}`).then((r) => r.data);

export const getMailStats = (userId: string) =>
  api.get<MailStats>(`/mail/stats/${userId}`).then((r) => r.data);

// ── Jobs ───────────────────────────────────────────────────────────────────

export type JobSource = 'indeed' | 'naukri' | 'internshala' | 'jsearch' | 'google' | 'company';

export interface JobListing {
  _id: string;
  title: string;
  company: string;
  location?: string;
  jd?: string;
  contactEmail?: string;
  applyUrl?: string;
  scrapeUrl?: string;
  source: JobSource;
  scrapedAt: string;
  postedAt?: string;
  postedAtDate?: string;
  matchedSkills: string[];
  flagged: boolean;
}

export interface JobsResponse {
  jobs: JobListing[];
  total: number;
  skills: string[];
}

export interface ScrapeEnqueueResult {
  jobId: string;
  status: 'queued';
}

export interface ScrapeCacheResult {
  status: 'cached';
  count: number;
}

export interface ScrapeNoSkillsResult {
  status: 'no_skills';
  message: string;
}

export type TriggerScrapeResult = ScrapeEnqueueResult | ScrapeCacheResult | ScrapeNoSkillsResult;

export interface ScrapeJobStatus {
  jobId: string;
  state: string;
  progress: number;
  result: {
    totalFound: number;
    totalStored: number;
    totalDuplicates: number;
    totalFlagged: number;
    bySource: Record<string, number>;
    durationMs: number;
  } | null;
  failedReason: string | null;
  attemptsMade: number;
}

export const triggerJobScrape = (payload: {
  userId: string;
  skills?: string[];
  companies?: string[];
  keywords?: string[];
  sources?: JobSource[];
  maxPerSource?: number;
  force?: boolean;
  country?: string;
}) => api.post<TriggerScrapeResult>('/jobs/scrape', payload).then((r) => r.data);

export const getScrapeJobStatus = (jobId: string) =>
  api.get<ScrapeJobStatus>(`/jobs/scrape/status/${jobId}`).then((r) => r.data);

export const getJobs = (params: {
  userId: string;
  skills?: string[];
  source?: JobSource;
  experienceLevel?: string;
  sortBy?: 'postedAt' | 'scrapedAt';
  limit?: number;
  skip?: number;
}) => {
  const queryParams: Record<string, string> = { userId: params.userId };
  if (params.skills?.length)    queryParams.skills          = params.skills.join(',');
  if (params.source)            queryParams.source          = params.source;
  if (params.experienceLevel)   queryParams.experienceLevel = params.experienceLevel;
  if (params.sortBy)            queryParams.sortBy          = params.sortBy;
  if (params.limit)             queryParams.limit           = String(params.limit);
  if (params.skip)              queryParams.skip            = String(params.skip);
  return api.get<JobsResponse>('/jobs', { params: queryParams }).then((r) => r.data);
};

export const getUserSkills = (userId: string) =>
  api.get<{ userId: string; skills: string[] }>(`/jobs/skills/${userId}`).then((r) => r.data);

// ── Cache Management ───────────────────────────────────────────────────────

export interface CacheStats {
  total: number;
  bySource: Record<string, number>;
  flagged: number;
  fresh24h: number;
  oldest: string | null;
  newest: string | null;
}

export const getCacheStats = () =>
  api.get<CacheStats>('/jobs/cache/stats').then((r) => r.data);

export const getCacheJobs = (params: { source?: JobSource; limit?: number; skip?: number }) => {
  const q: Record<string, string> = {};
  if (params.source) q.source = params.source;
  if (params.limit)  q.limit  = String(params.limit);
  if (params.skip)   q.skip   = String(params.skip);
  return api.get<JobListing[]>('/jobs/cache', { params: q }).then((r) => r.data);
};
export const deleteAllCache = () =>
  api.delete<{ deleted: number }>('/jobs/cache/all').then((r) => r.data);

export const deleteCacheBySource = (source: JobSource) =>
  api.delete<{ deleted: number }>(`/jobs/cache/source/${source}`).then((r) => r.data);

export const deleteCacheById = (id: string) =>
  api.delete<{ deleted: boolean }>(`/jobs/cache/${id}`).then((r) => r.data);

// ── Resume parse job status ────────────────────────────────────────────────

export interface ResumeParseResult {
  userId: string;
  cloudinaryUrl: string;
  rawText: string;
  parsedJson: Record<string, unknown>;
  llmAttempts: number;
}

export interface ResumeParseJobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  progress: number;
  result: ResumeParseResult | null;
  failedReason: string | null;
  attemptsMade: number;
}

// Response from POST /uploads/resume — now returns jobId immediately
export interface UploadEnqueueResult {
  jobId: string;
  status: 'queued';
  cloudinaryUrl: string;
}

export const getResumeParseJobStatus = (jobId: string) =>
  api.get<ResumeParseJobStatus>(`/uploads/resume/status/${jobId}`).then((r) => r.data);

export default api;
