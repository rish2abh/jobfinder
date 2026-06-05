import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  Mail,
  FileText,
  Eye,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  RefreshCw,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import EmailInput from '../components/EmailInput';
import FileUploader from '../components/FileUploader';
import {
  sendBulkMail,
  getBulkMailJobStatus,
  getUserResume,
} from '../services/api';
import { useUserStore } from '../store/userStore';
import type { BulkMailJobStatus, JobState } from '../services/api';

interface FormValues {
  subject: string;
  context: string;
}

type ResumeOption = 'existing' | 'upload';

// How often (ms) to poll the job status
const POLL_INTERVAL = 3000;

const STATE_CONFIG: Record<
  JobState,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  waiting:   { label: 'Waiting in queue', color: 'text-amber-600 bg-amber-50 border-amber-200',   icon: Clock },
  active:    { label: 'Sending emails…',  color: 'text-blue-600 bg-blue-50 border-blue-200',      icon: Loader2 },
  completed: { label: 'Completed',        color: 'text-green-600 bg-green-50 border-green-200',   icon: CheckCircle },
  failed:    { label: 'Failed',           color: 'text-red-600 bg-red-50 border-red-200',         icon: XCircle },
  delayed:   { label: 'Delayed',          color: 'text-purple-600 bg-purple-50 border-purple-200', icon: Clock },
  paused:    { label: 'Paused',           color: 'text-gray-600 bg-gray-50 border-gray-200',      icon: Clock },
  unknown:   { label: 'Unknown',          color: 'text-gray-600 bg-gray-50 border-gray-200',      icon: AlertCircle },
};

export default function BulkMail() {
  const { userId } = useUserStore();

  // Form state
  const [emails, setEmails] = useState<string[]>([]);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [resumeOption, setResumeOption] = useState<ResumeOption>('existing');
  const [uploadedResume, setUploadedResume] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showResults, setShowResults] = useState(true);

  // Job tracking state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>();
  const subjectVal = watch('subject', '');
  const contextVal = watch('context', '');

  // Check if user has an existing resume
  const resumeQuery = useQuery({
    queryKey: ['resume', userId],
    queryFn: () => getUserResume(userId!),
    enabled: !!userId,
    retry: false,
  });

  const hasExistingResume = !!(resumeQuery.data?.cloudinaryUrl || resumeQuery.data?.rawText);

  // Poll job status while active/waiting
  const jobStatusQuery = useQuery<BulkMailJobStatus>({
    queryKey: ['mailJob', activeJobId],
    queryFn: () => getBulkMailJobStatus(activeJobId!),
    enabled: !!activeJobId && isPolling,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === 'completed' || state === 'failed') {
        setIsPolling(false);
        return false;
      }
      return POLL_INTERVAL;
    },
    retry: false,
  });

  const jobData = jobStatusQuery.data;
  const jobState = jobData?.state ?? null;

  // Notify user when job finishes — useEffect to avoid side-effects in render
  useEffect(() => {
    if (jobState === 'completed' && jobData?.result) {
      const { sentCount = 0 } = jobData.result;
      toast.success(`Sent to ${sentCount} recipient${sentCount !== 1 ? 's' : ''}!`);
    }
    if (jobState === 'failed') {
      toast.error(`Job failed: ${jobData?.failedReason ?? 'unknown error'}`);
    }
  }, [jobState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Submit → enqueue job
  const mutation = useMutation({
    mutationFn: (data: FormValues) =>
      sendBulkMail({
        subject: data.subject,
        context: data.context,
        mailIds: emails,
        userId: resumeOption === 'existing' ? userId ?? undefined : undefined,
        resume: resumeOption === 'upload' ? uploadedResume : null,
      }),
    onSuccess: ({ jobId }) => {
      setActiveJobId(jobId);
      setIsPolling(true);
      setShowResults(true);
      toast.success(`Job queued — tracking #${jobId}`);
    },
  });

  const onSubmit = (data: FormValues) => {
    if (emails.length === 0) {
      setEmailsError('Add at least one email address');
      return;
    }
    setEmailsError(null);

    if (resumeOption === 'upload' && !uploadedResume) {
      toast.error('Please upload a resume PDF or switch to use your existing one');
      return;
    }

    mutation.mutate(data);
  };

  const result = jobData?.result;
  const sentCount  = result?.sentCount  ?? result?.sent?.length  ?? 0;
  const failedCount = result?.failedCount ?? result?.failed?.length ?? 0;
  const isJobRunning = jobState === 'waiting' || jobState === 'active' || jobState === 'delayed';

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bulk Mail</h1>
        <p className="text-gray-500 mt-1">
          Emails are processed asynchronously via a job queue — submit and track progress in real time.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Email Content */}
        <div className="card p-5 space-y-5">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-3">
            Email Content
          </h2>

          <div>
            <label htmlFor="subject" className="label">
              Subject <span className="text-red-500">*</span>
            </label>
            <input
              id="subject"
              type="text"
              placeholder="Application for Software Developer Role at {Company}"
              className={`input ${errors.subject ? 'border-red-400' : ''}`}
              {...register('subject', { required: 'Subject is required' })}
            />
            {errors.subject && (
              <p className="mt-1 text-xs text-red-600">{errors.subject.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="context" className="label">
              Email Body <span className="text-red-500">*</span>
            </label>
            <textarea
              id="context"
              rows={5}
              placeholder="Hello, I am writing to express my interest in the position. Please find my resume attached for your consideration..."
              className={`input resize-none ${errors.context ? 'border-red-400' : ''}`}
              {...register('context', {
                required: 'Email body is required',
                minLength: { value: 20, message: 'Body should be at least 20 characters' },
              })}
            />
            {errors.context && (
              <p className="mt-1 text-xs text-red-600">{errors.context.message}</p>
            )}
          </div>
        </div>

        {/* Recipients */}
        <div className="card p-5 space-y-4">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-3">
            Recipients
          </h2>
          <div>
            <label className="label">
              Email Addresses <span className="text-red-500">*</span>
            </label>
            <EmailInput emails={emails} onChange={setEmails} error={emailsError ?? undefined} />
            {emails.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                {emails.length} recipient{emails.length > 1 ? 's' : ''} added
              </p>
            )}
          </div>
        </div>

        {/* Resume Option */}
        <div className="card p-5 space-y-4">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-3">
            Resume Attachment
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setResumeOption('existing')}
              className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                resumeOption === 'existing'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <FileText className="w-4 h-4 flex-shrink-0" />
              Use Existing Resume
            </button>
            <button
              type="button"
              onClick={() => setResumeOption('upload')}
              className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                resumeOption === 'upload'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <Mail className="w-4 h-4 flex-shrink-0" />
              Upload New Resume
            </button>
          </div>

          {resumeOption === 'existing' && (
            <div className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
              hasExistingResume
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              {hasExistingResume ? (
                <><CheckCircle className="w-4 h-4 flex-shrink-0" /><span>Your uploaded resume will be used</span></>
              ) : (
                <><AlertCircle className="w-4 h-4 flex-shrink-0" /><span>No resume found. Upload one first or choose a new file.</span></>
              )}
            </div>
          )}

          {resumeOption === 'upload' && (
            <FileUploader
              onFileSelect={setUploadedResume}
              selectedFile={uploadedResume}
              label="Upload resume for this mailing"
            />
          )}
        </div>

        {/* Email Preview */}
        {(subjectVal || contextVal || emails.length > 0) && (
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Eye className="w-4 h-4" /> Email Preview
              </span>
              {showPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showPreview && (
              <div className="p-5 border-t border-gray-100 space-y-4 bg-white">
                <div className="space-y-2 text-sm">
                  <div className="flex gap-3">
                    <span className="text-gray-400 w-16 flex-shrink-0">To:</span>
                    <div className="flex flex-wrap gap-1">
                      {emails.length > 0
                        ? emails.map((e) => (
                            <span key={e} className="badge bg-gray-100 text-gray-600">{e}</span>
                          ))
                        : <span className="text-gray-400">—</span>}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-gray-400 w-16 flex-shrink-0">Subject:</span>
                    <span className="font-medium text-gray-900">{subjectVal || '—'}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-gray-400 w-16 flex-shrink-0">Resume:</span>
                    <span className="text-gray-700">
                      {resumeOption === 'existing'
                        ? hasExistingResume ? 'Existing resume (from profile)' : 'No resume'
                        : uploadedResume ? uploadedResume.name : 'No file selected'}
                    </span>
                  </div>
                </div>
                {contextVal && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-700 whitespace-pre-wrap">
                    {contextVal}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={mutation.isPending || isJobRunning}
          className="btn-primary w-full py-3 text-base"
        >
          {mutation.isPending ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Queuing job…</>
          ) : isJobRunning ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Job in progress…</>
          ) : (
            <>
              <Send className="w-5 h-5" />
              Send to {emails.length > 0 ? `${emails.length} recipient${emails.length > 1 ? 's' : ''}` : 'recipients'}
            </>
          )}
        </button>
      </form>

      {/* ── Job Status Tracker ──────────────────────────────────────────── */}
      {activeJobId && (
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-primary-500" />
              <span className="font-semibold text-gray-900">Job Tracker</span>
              <span className="text-xs text-gray-400 font-mono">#{activeJobId}</span>
            </div>
            <div className="flex items-center gap-2">
              {isPolling && (
                <span className="flex items-center gap-1.5 text-xs text-blue-600">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Live
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowResults((p) => !p)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Toggle results"
              >
                {showResults ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {showResults && (
            <div className="p-5 space-y-4">
              {/* State badge */}
              {jobState && (() => {
                const cfg = STATE_CONFIG[jobState] ?? STATE_CONFIG.unknown;
                const Icon = cfg.icon;
                return (
                  <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium ${cfg.color}`}>
                    <Icon className={`w-4 h-4 flex-shrink-0 ${jobState === 'active' ? 'animate-spin' : ''}`} />
                    {cfg.label}
                    {jobData && (
                      <span className="ml-auto text-xs font-normal opacity-70">
                        Attempt {jobData.attemptsMade}
                        {jobData.attemptsMade > 1 ? ` / 3` : ''}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Loading skeleton while polling and no result yet */}
              {isPolling && !result && (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              )}

              {/* Failed reason */}
              {jobState === 'failed' && jobData?.failedReason && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{jobData.failedReason}</span>
                </div>
              )}

              {/* Result breakdown */}
              {result && jobState === 'completed' && (
                <>
                  {/* Summary row */}
                  <div className="flex gap-3">
                    {sentCount > 0 && (
                      <div className="flex-1 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <div>
                          <p className="text-lg font-bold text-green-700">{sentCount}</p>
                          <p className="text-xs text-green-600">Sent</p>
                        </div>
                      </div>
                    )}
                    {failedCount > 0 && (
                      <div className="flex-1 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                        <XCircle className="w-5 h-5 text-red-600" />
                        <div>
                          <p className="text-lg font-bold text-red-700">{failedCount}</p>
                          <p className="text-xs text-red-600">Failed</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Per-recipient rows */}
                  <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                    {(result.sent ?? []).map((email) => (
                      <div key={email} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="text-gray-800 flex-1 truncate">{email}</span>
                        <span className="badge bg-green-100 text-green-700">Sent</span>
                      </div>
                    ))}
                    {(result.failed ?? []).map((email) => (
                      <div key={email} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <span className="text-gray-800 flex-1 truncate">{email}</span>
                        <span className="badge bg-red-100 text-red-700">Failed</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* New job button after completion */}
              {(jobState === 'completed' || jobState === 'failed') && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveJobId(null);
                    setIsPolling(false);
                  }}
                  className="btn-secondary w-full text-sm"
                >
                  Send another batch
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
