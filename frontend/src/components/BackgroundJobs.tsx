import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getActiveJobs, retryJob, type MonitoredJob, type JobType } from '../services/api';

const JOB_TYPE_LABELS: Record<JobType, string> = {
  'resume-parse': 'Resume Parse',
  'job-scrape': 'Job Scrape',
  'bulk-mail': 'Bulk Mail',
  'matching': 'Matching',
  'auto-apply': 'Auto Apply',
};

const JOB_TYPE_COLORS: Record<JobType, string> = {
  'resume-parse': 'bg-blue-100 text-blue-700',
  'job-scrape': 'bg-purple-100 text-purple-700',
  'bulk-mail': 'bg-green-100 text-green-700',
  'matching': 'bg-amber-100 text-amber-700',
  'auto-apply': 'bg-rose-100 text-rose-700',
};

function StateIcon({ state }: { state: string }) {
  switch (state) {
    case 'active':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'waiting':
    case 'delayed':
      return <Clock className="w-4 h-4 text-gray-400" />;
    default:
      return <Activity className="w-4 h-4 text-gray-400" />;
  }
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    waiting: 'bg-gray-100 text-gray-600',
    delayed: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors[state] ?? 'bg-gray-100 text-gray-600'}`}>
      <StateIcon state={state} />
      {state}
    </span>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className="bg-primary-500 h-2 rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

function JobRow({ job, onRetry }: { job: MonitoredJob; onRetry: (type: JobType, id: string) => void }) {
  const canRetry = job.state === 'failed' && (job.type === 'resume-parse' || job.type === 'job-scrape');
  const timeAgo = formatTimeAgo(job.timestamp);

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${JOB_TYPE_COLORS[job.type]}`}>
            {JOB_TYPE_LABELS[job.type]}
          </span>
          <StateBadge state={job.state} />
          <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{timeAgo}</span>
        </div>

        {(job.state === 'active' || job.state === 'waiting') && (
          <div className="mt-1.5">
            <ProgressBar progress={job.progress} />
            <span className="text-xs text-gray-500 mt-0.5">{job.progress}%</span>
          </div>
        )}

        {job.state === 'failed' && job.failedReason && (
          <p className="text-xs text-red-600 mt-1 truncate" title={job.failedReason}>
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            {job.failedReason}
          </p>
        )}
      </div>

      {canRetry && (
        <button
          type="button"
          onClick={() => onRetry(job.type, job.id)}
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-primary-600 transition-colors"
          title="Retry this job"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}

      {job.state === 'failed' && job.type === 'bulk-mail' && (
        <span className="flex-shrink-0 text-xs text-gray-400 italic">No auto-retry</span>
      )}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function BackgroundJobs() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['monitor-jobs'],
    queryFn: getActiveJobs,
    refetchInterval: 5000,
  });

  const retryMutation = useMutation({
    mutationFn: ({ type, jobId }: { type: 'resume-parse' | 'job-scrape'; jobId: string }) =>
      retryJob(type, jobId),
    onSuccess: (result) => {
      if (result.status === 'retried') {
        toast.success('Job queued for retry');
        queryClient.invalidateQueries({ queryKey: ['monitor-jobs'] });
      } else {
        toast.error('Job is not in a failed state');
      }
    },
  });

  const jobs = data?.jobs ?? [];

  // Group by type
  const grouped = jobs.reduce<Record<string, MonitoredJob[]>>((acc, job) => {
    if (!acc[job.type]) acc[job.type] = [];
    acc[job.type].push(job);
    return acc;
  }, {});

  const handleRetry = (type: JobType, jobId: string) => {
    if (type === 'resume-parse' || type === 'job-scrape') {
      retryMutation.mutate({ type, jobId });
    }
  };

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary-500" />
          Background Jobs
        </h2>
        <button
          type="button"
          onClick={() => refetch()}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          No active or recent background jobs.
        </p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([type, typeJobs]) => (
            <div key={type}>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                {JOB_TYPE_LABELS[type as JobType]} ({typeJobs.length})
              </h3>
              <div className="bg-gray-50 rounded-lg px-3 py-1">
                {typeJobs.map((job) => (
                  <JobRow key={job.id + job.type} job={job} onRetry={handleRetry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
