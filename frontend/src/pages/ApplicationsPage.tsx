import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Clock, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Filter, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useUserStore } from '../store/userStore';
import {
  getApplications,
  getApplicationStats,
  type Application,
  type ApplicationStatus,
} from '../services/api';

const PAGE_SIZE = 20;

const STATUS_CONFIG: Record<ApplicationStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  applied: { label: 'Applied', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle },
  requires_manual_action: { label: 'Manual Action', color: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  pending: { label: 'Pending', color: 'bg-blue-100 text-blue-700', icon: Clock },
};

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function relativeDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ApplicationCard({ application }: { application: Application }) {
  const [expanded, setExpanded] = useState(false);
  const hasSkippedFields =
    application.status === 'requires_manual_action' &&
    application.skippedFields &&
    application.skippedFields.length > 0;

  return (
    <div className="card p-4 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {application.job?.title ?? 'Unknown Job'}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {application.job?.company ?? 'Unknown Company'}
          </p>
        </div>
        <StatusBadge status={application.status} />
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {relativeDate(application.appliedAt ?? application.createdAt)}
        </span>
        {application.platform && (
          <span className="capitalize">{application.platform}</span>
        )}
      </div>

      {application.failureReason && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {application.failureReason}
        </p>
      )}

      {hasSkippedFields && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Hide' : 'Show'} skipped fields ({application.skippedFields!.length})
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1 text-xs bg-amber-50 border border-amber-100 rounded-lg p-3">
              {application.skippedFields!.map((field, i) => (
                <li key={i} className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{field.fieldIdentifier}</strong> — {field.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApplicationsPage() {
  const { userId } = useUserStore();

  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | ''>('');
  const [page, setPage] = useState(0);

  // Fetch applications
  const applicationsQuery = useQuery({
    queryKey: ['applications', userId, statusFilter, page],
    queryFn: () =>
      getApplications(userId!, {
        status: statusFilter || undefined,
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: !!userId,
  });

  // Fetch stats
  const statsQuery = useQuery({
    queryKey: ['applicationStats', userId],
    queryFn: () => getApplicationStats(userId!),
    enabled: !!userId,
  });

  const applications = applicationsQuery.data?.applications ?? [];
  const total = applicationsQuery.data?.total ?? 0;
  const stats = statsQuery.data;

  const statusFilters: { value: ApplicationStatus | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'applied', label: 'Applied' },
    { value: 'failed', label: 'Failed' },
    { value: 'requires_manual_action', label: 'Manual Action' },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
          <p className="text-gray-500 mt-1">Track your auto-applied job applications.</p>
        </div>
        {applicationsQuery.isFetching && !applicationsQuery.isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
          </span>
        )}
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.pending}</p>
            <p className="text-xs text-gray-500 mt-1">Pending</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.applied}</p>
            <p className="text-xs text-gray-500 mt-1">Applied</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-xs text-gray-500 mt-1">Failed</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{stats.requires_manual_action}</p>
            <p className="text-xs text-gray-500 mt-1">Manual Action</p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex gap-1.5 flex-wrap">
            {statusFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => { setStatusFilter(f.value); setPage(0); }}
                className={`badge cursor-pointer text-xs ${
                  statusFilter === f.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {total > 0 && (
            <span className="ml-auto text-sm text-gray-400 whitespace-nowrap">
              {total} application{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Loading state */}
      {applicationsQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!applicationsQuery.isLoading && applications.length === 0 && (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-500 font-medium">No applications yet</h3>
          <p className="text-sm text-gray-400 mt-1">
            {statusFilter
              ? 'No applications match the selected filter.'
              : 'Use Auto Apply on job listings to start tracking applications.'}
          </p>
        </div>
      )}

      {/* Applications grid */}
      {applications.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {applications.map((app) => (
              <ApplicationCard key={app._id} application={app} />
            ))}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-secondary text-sm"
              >
                ← Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total}
                className="btn-secondary text-sm"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Export mutations for use in JobListings page
export { StatusBadge };
