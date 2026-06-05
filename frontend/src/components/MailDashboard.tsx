import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Mail,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  AlertCircle,
  Loader2,
  ChevronRight,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { getMailStats, getMailHistory } from '../services/api';
import { useUserStore } from '../store/userStore';
import type { MailJobSummary, JobState } from '../services/api';

// Refresh every 10 s so in-progress jobs update automatically
const STATS_REFRESH_MS = 10_000;

const STATE_BADGE: Record<
  JobState,
  { label: string; classes: string; icon: React.ComponentType<{ className?: string }> }
> = {
  waiting:   { label: 'Waiting',   classes: 'bg-amber-100 text-amber-700',   icon: Clock },
  active:    { label: 'Sending…',  classes: 'bg-blue-100 text-blue-700',     icon: Loader2 },
  completed: { label: 'Completed', classes: 'bg-green-100 text-green-700',   icon: CheckCircle },
  failed:    { label: 'Failed',    classes: 'bg-red-100 text-red-700',       icon: XCircle },
  delayed:   { label: 'Delayed',   classes: 'bg-purple-100 text-purple-700', icon: Clock },
  paused:    { label: 'Paused',    classes: 'bg-gray-100 text-gray-600',     icon: Clock },
  unknown:   { label: 'Unknown',   classes: 'bg-gray-100 text-gray-600',     icon: AlertCircle },
};

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-gray-200">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500 leading-tight">{label}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: MailJobSummary }) {
  const cfg = STATE_BADGE[job.state] ?? STATE_BADGE.unknown;
  const Icon = cfg.icon;
  const date = new Date(job.timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50 transition-colors">
      {/* State icon */}
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${
          job.state === 'active' ? 'animate-spin text-blue-500' :
          job.state === 'completed' ? 'text-green-500' :
          job.state === 'failed' ? 'text-red-500' : 'text-gray-400'
        }`}
      />

      {/* Subject */}
      <span className="flex-1 text-gray-800 truncate" title={job.subject}>
        {job.subject || '(no subject)'}
      </span>

      {/* Recipients / sent / failed */}
      <span className="hidden sm:block text-xs text-gray-400 whitespace-nowrap">
        {job.state === 'completed'
          ? `${job.sentCount} sent${job.failedCount > 0 ? `, ${job.failedCount} failed` : ''}`
          : `${job.recipientCount} recipient${job.recipientCount !== 1 ? 's' : ''}`}
      </span>

      {/* State badge */}
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
        {cfg.label}
      </span>

      {/* Date */}
      <span className="hidden md:block text-xs text-gray-400 whitespace-nowrap">{date}</span>
    </div>
  );
}

export default function MailDashboard() {
  const { userId } = useUserStore();

  const statsQuery = useQuery({
    queryKey: ['mailStats', userId],
    queryFn: () => getMailStats(userId!),
    enabled: !!userId,
    refetchInterval: STATS_REFRESH_MS,
    staleTime: 0,
  });

  const historyQuery = useQuery({
    queryKey: ['mailHistory', userId],
    queryFn: () => getMailHistory(userId!),
    enabled: !!userId,
    refetchInterval: STATS_REFRESH_MS,
    staleTime: 0,
  });

  const stats = statsQuery.data;
  const jobs = historyQuery.data ?? [];

  // Show only the 5 most recent jobs on the dashboard
  const recentJobs = jobs.slice(0, 5);

  const isLoading = statsQuery.isLoading && historyQuery.isLoading;
  const isRefreshing = statsQuery.isFetching || historyQuery.isFetching;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary-500" />
          <h2 className="text-base font-semibold text-gray-900">Mail Dashboard</h2>
          {isRefreshing && !isLoading && (
            <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin" />
          )}
        </div>
        <Link
          to="/dashboard/bulk-mail"
          className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          Send Mail <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="p-5 space-y-5">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-xl" />
              ))}
            </div>
            <div className="h-32 bg-gray-100 rounded-xl" />
          </div>
        )}

        {/* Stats grid */}
        {stats && !isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label="Emails Sent"
              value={stats.totalSent}
              icon={Send}
              color="bg-green-500"
            />
            <StatTile
              label="Failed"
              value={stats.totalFailed}
              icon={XCircle}
              color={stats.totalFailed > 0 ? 'bg-red-500' : 'bg-gray-400'}
            />
            <StatTile
              label="In Progress"
              value={stats.pendingJobs}
              sub={stats.pendingJobs > 0 ? 'updating live…' : undefined}
              icon={Zap}
              color={stats.pendingJobs > 0 ? 'bg-blue-500' : 'bg-gray-400'}
            />
            <StatTile
              label="Total Jobs"
              value={stats.totalJobs}
              sub={`${stats.completedJobs} completed`}
              icon={Mail}
              color="bg-primary-500"
            />
          </div>
        )}

        {/* No jobs yet */}
        {!isLoading && jobs.length === 0 && (
          <div className="text-center py-8">
            <Mail className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">No mail jobs yet</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">
              Send your first bulk mail to start tracking progress here.
            </p>
            <Link to="/dashboard/bulk-mail" className="btn-primary text-sm">
              <Send className="w-4 h-4" /> Send Bulk Mail
            </Link>
          </div>
        )}

        {/* Recent jobs list */}
        {recentJobs.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 px-1">
              Recent Jobs
            </p>
            <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {recentJobs.map((job) => (
                <JobRow key={job.jobId} job={job} />
              ))}
            </div>

            {jobs.length > 5 && (
              <Link
                to="/dashboard/bulk-mail"
                className="flex items-center justify-center gap-1 mt-3 text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                View all {jobs.length} jobs <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
