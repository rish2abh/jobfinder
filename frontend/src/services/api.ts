import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: 'http://localhost:4000',
  timeout: 30000,
  withCredentials: true,
});

// Flag to avoid multiple concurrent refresh requests
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((p) => {
    if (error) p.reject(error);
    else p.resolve(token!);
  });
  failedQueue = [];
};

// Request interceptor — attach Bearer token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — handle 401 + silent refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retried — attempt token refresh
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/register') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        // Queue the request until refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(
          'http://localhost:4000/auth/refresh',
          {},
          { withCredentials: true },
        );
        const newToken = data.accessToken;
        useAuthStore.getState().setAccessToken(newToken);
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().clearAuth();
        // Redirect to login
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
          window.location.href = '/auth/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred';

    // Don't auto-toast for 404 on resume (user may not have uploaded yet)
    const isResumeNotFound =
      error.response?.status === 404 &&
      error.config?.url?.includes('/resume');

    // Don't toast auth errors (handled silently)
    const isAuthError = error.response?.status === 401;

    if (!isResumeNotFound && !isAuthError) {
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }

    return Promise.reject(error);
  },
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

export const getUserMe = () =>
  api.get<User>('/users/me').then((r) => r.data);

export const getUserByEmail = (email: string) =>
  api.get<User>(`/users/by-email/${encodeURIComponent(email)}`).then((r) => r.data);

export const getUserResume = (_id?: string) =>
  api.get<ResumeData>('/users/me/resume').then((r) => r.data);

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

export const getUserProfile = (_id?: string) =>
  api.get<UserProfile>('/users/me/profile').then((r) => r.data);

export const updateUserProfile = (_id: string, data: UpdateProfilePayload) =>
  api.patch<User>('/users/me/profile', data).then((r) => r.data);

export const extractProfileFromResume = (_id?: string) =>
  api.post<UserProfile>('/users/me/profile/extract').then((r) => r.data);

// ── Uploads ────────────────────────────────────────────────────────────────

export type LlmProvider = 'groq' | 'ollama' | 'claude' | 'llamaparse';

export interface UploadResumePayload {
  userId?: string;
  file: File;
  provider?: LlmProvider;
  onUploadProgress?: (percent: number) => void;
}

export const uploadResume = ({ file, provider, onUploadProgress }: UploadResumePayload) => {
  const formData = new FormData();
  formData.append('file', file);
  if (provider) {
    formData.append('provider', provider);
  }

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

export const getMailHistory = (_userId?: string) =>
  api.get<MailJobSummary[]>('/mail/history').then((r) => r.data);

export const getMailStats = (_userId?: string) =>
  api.get<MailStats>('/mail/stats').then((r) => r.data);

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
  userId?: string;
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
  userId?: string;
  skills?: string[];
  source?: JobSource;
  experienceLevel?: string;
  keyword?: string;
  sortBy?: 'postedAt' | 'scrapedAt';
  limit?: number;
  skip?: number;
}) => {
  const queryParams: Record<string, string> = {};
  if (params.skills?.length)    queryParams.skills          = params.skills.join(',');
  if (params.source)            queryParams.source          = params.source;
  if (params.experienceLevel)   queryParams.experienceLevel = params.experienceLevel;
  if (params.keyword)           queryParams.keyword         = params.keyword;
  if (params.sortBy)            queryParams.sortBy          = params.sortBy;
  if (params.limit)             queryParams.limit           = String(params.limit);
  if (params.skip)              queryParams.skip            = String(params.skip);
  return api.get<JobsResponse>('/jobs', { params: queryParams }).then((r) => r.data);
};

export const getUserSkills = (_userId?: string) =>
  api.get<{ userId: string; skills: string[] }>('/jobs/skills').then((r) => r.data);

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

export interface CleanQueueResult {
  removed: {
    completed: number;
    failed: number;
    delayed: number;
    waiting: number;
    active: number;
  };
}

export const cleanResumeQueue = () =>
  api.post<CleanQueueResult>('/uploads/resume/queue/clean').then((r) => r.data);

// ── Auth ───────────────────────────────────────────────────────────────────

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
}

export const login = (data: LoginPayload) =>
  api.post<AuthResponse>('/auth/login', data).then((r) => r.data);

export const register = (data: RegisterPayload) =>
  api.post<AuthResponse>('/auth/register', data).then((r) => r.data);

export const logout = () =>
  api.post('/auth/logout').then((r) => r.data);

export const getAuthMe = () =>
  api.get<User>('/auth/me').then((r) => r.data);

// ── Matching ───────────────────────────────────────────────────────────────

export interface MatchScore {
  userId: string;
  jobId: string;
  cosineSimilarity: number;
  skillOverlap: number;
  finalScore: number;
  degraded: boolean;
  computedAt: string;
  job?: JobListing;
}

export interface MatchScoresResponse {
  scores: MatchScore[];
  total: number;
  skip: number;
  limit: number;
}

export interface RecomputeResponse {
  jobId: string;
  status: string;
  invalidated: number;
}

export const getMatchScores = (userId: string, params?: { skip?: number; limit?: number }) =>
  api.get<MatchScoresResponse>(`/matching/scores/${userId}`, { params }).then((r) => r.data);

export const recomputeScores = (userId: string) =>
  api.post<RecomputeResponse>(`/matching/recompute/${userId}`).then((r) => r.data);

export const getMatchingStatus = (jobId: string) =>
  api.get<{ jobId: string; state: string; progress: number; result: any; failedReason: string | null }>(`/matching/status/${jobId}`).then((r) => r.data);

// ── Applications ───────────────────────────────────────────────────────────

export type ApplicationStatus = 'pending' | 'applied' | 'failed' | 'requires_manual_action';

export interface Application {
  _id: string;
  userId: string;
  jobId: string;
  status: ApplicationStatus;
  platform?: string;
  applyUrl?: string;
  failureReason?: string;
  skippedFields?: Array<{ fieldIdentifier: string; reason: string }>;
  appliedAt?: string;
  createdAt: string;
  job?: JobListing;
}

export interface ApplicationsResponse {
  applications: Application[];
  total: number;
}

export interface ApplicationStats {
  pending: number;
  applied: number;
  failed: number;
  requires_manual_action: number;
  total: number;
}

export const getApplications = (userId: string, params?: { status?: string; skip?: number; limit?: number }) =>
  api.get<ApplicationsResponse>(`/applications/list/${userId}`, { params }).then((r) => r.data);

export const getApplicationStats = (userId: string) =>
  api.get<ApplicationStats>(`/applications/stats/${userId}`).then((r) => r.data);

export const triggerApply = (jobId: string) =>
  api.post<{ jobId: string; status: string }>('/applications/apply', { jobId }).then((r) => r.data);

export const triggerBatchApply = (jobIds: string[]) =>
  api.post<{ jobIds: string[]; status: string }>('/applications/batch-apply', { jobIds }).then((r) => r.data);

export const getApplyStatus = (jobId: string) =>
  api.get<{ jobId: string; state: string; progress: number }>(`/applications/status/${jobId}`).then((r) => r.data);

// ── Contacts ───────────────────────────────────────────────────────────────

export interface ContactUploadResult {
  totalParsed: number;
  storedCount: number;
  skippedCount: number;
  duplicateCount: number;
  skipped: Array<{ row: number; reason: string }>;
  contacts?: Array<{ name: string; email: string; title: string | null; company: string | null }>;
}

export interface ContactGroup {
  _id: string;
  userId: string;
  groupType: string;
  groupValue: string;
  contactIds: string[];
  templateId?: string;
  createdAt: string;
}

export interface EmailTemplate {
  _id: string;
  groupId: string;
  userId: string;
  subject: string;
  body: string;
  generatedBy: string;
  aiProvider?: 'groq' | 'ollama' | null;
  cachedAt: string;
}

export interface BulkSendResult {
  bulkJobId: string;
  totalRecipients: number;
  status: string;
}

export interface BulkSendStatus {
  bulkJobId: string;
  total: number;
  completed: number;
  failed: number;
  active: number;
  waiting: number;
}

export const uploadContacts = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post<ContactUploadResult>('/contacts/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // 2 minutes — parsing large files can take time
  }).then((r) => r.data);
};

export const groupContacts = (groupBy: 'title' | 'company', contactIds?: string[]) =>
  api.post<ContactGroup[]>('/contacts/group', { groupBy, ...(contactIds?.length ? { contactIds } : {}) }).then((r) => r.data);

export interface BulkContact {
  _id: string;
  name: string;
  email: string;
  title?: string;
  company?: string;
  sourceFile: string;
  uploadedAt: string;
}

export const getContacts = () =>
  api.get<BulkContact[]>('/contacts').then((r) => r.data);

export const getContactGroups = () =>
  api.get<ContactGroup[]>('/contacts/groups').then((r) => r.data);

export const getSavedTemplates = () =>
  api.get<EmailTemplate[]>('/contacts/templates').then((r) => r.data);

export const generateTemplates = (groupIds: string[], userPrompt?: string) =>
  api.post<EmailTemplate[]>('/contacts/generate-templates', { groupIds, userPrompt }).then((r) => r.data);

export const editTemplate = (groupId: string, subject: string, body: string) =>
  api.patch<EmailTemplate>(`/contacts/templates/${groupId}`, { subject, body }).then((r) => r.data);

export const triggerBulkSend = (groupIds: string[], from?: string, resumeUrl?: string, contactIds?: string[]) =>
  api.post<BulkSendResult>('/contacts/send', {
    groupIds,
    ...(from ? { from } : {}),
    ...(resumeUrl ? { resumeUrl } : {}),
    ...(contactIds?.length ? { contactIds } : {}),
  }).then((r) => r.data);

export const getBulkSendStatus = (jobId: string) =>
  api.get<BulkSendStatus>(`/contacts/send/status/${jobId}`).then((r) => r.data);

// ── Job Monitor ────────────────────────────────────────────────────────────

export type JobType = 'resume-parse' | 'job-scrape' | 'bulk-mail' | 'matching' | 'auto-apply';

export interface MonitoredJob {
  id: string;
  type: JobType;
  state: string;
  progress: number;
  failedReason: string | null;
  timestamp: number;
  data?: Record<string, any>;
}

export interface MonitoredJobsResponse {
  jobs: MonitoredJob[];
}

export const getActiveJobs = () =>
  api.get<MonitoredJobsResponse>('/jobs/monitor/active').then((r) => r.data);

export const retryJob = (type: 'resume-parse' | 'job-scrape', jobId: string) =>
  api.post<{ status: string; jobId: string }>(`/jobs/monitor/retry/${type}/${jobId}`).then((r) => r.data);

export default api;
