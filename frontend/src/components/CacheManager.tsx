import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Database, Trash2, RefreshCw, ChevronDown, ChevronUp,
  Clock, AlertTriangle, CheckCircle, X, Loader2, Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getCacheStats, getCacheJobs, deleteAllCache,
  deleteCacheBySource, deleteCacheById,
  type JobSource, type CacheStats, type JobListing,
} from '../services/api';

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  google:      { label: 'Google Jobs',  color: 'bg-red-100 text-red-700' },
  indeed:      { label: 'Indeed',       color: 'bg-blue-100 text-blue-700' },
  naukri:      { label: 'Naukri',       color: 'bg-orange-100 text-orange-700' },
  internshala: { label: 'Internshala',  color: 'bg-green-100 text-green-700' },
  jsearch:     { label: 'JSearch API',  color: 'bg-purple-100 text-purple-700' },
  company:     { label: 'Company',      color: 'bg-gray-100 text-gray-600' },
};

function relDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (diff < 1)  return 'Just now';
  if (diff < 24) return `${diff}h ago`;
  return `${Math.floor(diff / 24)}d ago`;
}

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}
function ConfirmDialog({ message, onConfirm, onCancel, loading }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700">{message}</p>
        </div>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} disabled={loading}
            className="btn-secondary text-sm px-4">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className="btn-primary text-sm px-4 bg-red-600 hover:bg-red-700 border-red-600">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CacheManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewSource, setViewSource] = useState<JobSource | undefined>();
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  const statsQuery = useQuery({
    queryKey: ['cacheStats'],
    queryFn: getCacheStats,
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  const jobsQuery = useQuery({
    queryKey: ['cacheJobs', viewSource],
    queryFn: () => getCacheJobs({ source: viewSource, limit: 500 }),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cacheStats'] });
    qc.invalidateQueries({ queryKey: ['cacheJobs'] });
    qc.invalidateQueries({ queryKey: ['jobs'] });
  };

  const deleteAllMut = useMutation({
    mutationFn: deleteAllCache,
    onSuccess: (r) => { toast.success(`Deleted all ${r.deleted} cached jobs`); invalidate(); },
  });

  const deleteSourceMut = useMutation({
    mutationFn: (source: JobSource) => deleteCacheBySource(source),
    onSuccess: (r) => { toast.success(`Deleted ${r.deleted} jobs`); invalidate(); },
  });

  const deleteOneMut = useMutation({
    mutationFn: (id: string) => deleteCacheById(id),
    onSuccess: () => { toast.success('Job removed from cache'); invalidate(); },
  });

  const isDeleting = deleteAllMut.isPending || deleteSourceMut.isPending || deleteOneMut.isPending;

  const confirm = (msg: string, action: () => void) => {
    setConfirmMsg(msg);
    setConfirmAction(() => action);
  };

  const stats: CacheStats | undefined = statsQuery.data;
  const jobs: JobListing[] = jobsQuery.data ?? [];

  return (
    <>
      {confirmMsg && confirmAction && (
        <ConfirmDialog
          message={confirmMsg}
          loading={isDeleting}
          onConfirm={() => { confirmAction(); setConfirmMsg(null); setConfirmAction(null); }}
          onCancel={() => { setConfirmMsg(null); setConfirmAction(null); }}
        />
      )}

      <div className="card overflow-hidden">
        {/* Header */}
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <Database className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900">Cache Manager</p>
              <p className="text-xs text-gray-400">
                {stats ? `${stats.total} jobs · ${stats.fresh24h} fresh (<24h)` : 'Manage stored job listings'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats && stats.total > 0 && (
              <span className="badge bg-amber-100 text-amber-700 text-xs">{stats.total} cached</span>
            )}
            {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </button>

        {open && (
          <div className="border-t border-gray-100 p-5 space-y-5">

            {/* Stats bar */}
            {statsQuery.isLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading stats…
              </div>
            )}

            {stats && (
              <div className="space-y-4">
                {/* Summary tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Jobs',    value: stats.total,    icon: Database,      color: 'text-gray-600',  bg: 'bg-gray-50' },
                    { label: 'Fresh (<24h)',  value: stats.fresh24h, icon: CheckCircle,   color: 'text-green-600', bg: 'bg-green-50' },
                    { label: 'Flagged',       value: stats.flagged,  icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'Newest',        value: relDate(stats.newest), icon: Clock, color: 'text-blue-600',  bg: 'bg-blue-50' },
                  ].map(({ label, value, icon: Icon, color, bg }) => (
                    <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                      <p className="text-base font-bold text-gray-900">{value}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>

                {/* By source breakdown + per-source delete */}
                {Object.keys(stats.bySource).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">By Source</p>
                    <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                      {Object.entries(stats.bySource).map(([src, count]) => {
                        const cfg = SOURCE_LABELS[src] ?? { label: src, color: 'bg-gray-100 text-gray-600' };
                        return (
                          <div key={src} className="flex items-center gap-3 px-4 py-3">
                            <span className={`badge text-xs flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
                            <span className="text-sm text-gray-700 flex-1">{count} jobs</span>
                            <button
                              type="button"
                              onClick={() => confirm(
                                `Delete all ${count} ${cfg.label} jobs from cache? This cannot be undone.`,
                                () => deleteSourceMut.mutate(src as JobSource),
                              )}
                              disabled={isDeleting}
                              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Clear
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Global actions */}
                <div className="flex flex-wrap gap-3 pt-1 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => statsQuery.refetch()}
                    disabled={statsQuery.isFetching}
                    className="btn-secondary text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${statsQuery.isFetching ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>

                  {stats.total > 0 && (
                    <button
                      type="button"
                      onClick={() => confirm(
                        `Delete ALL ${stats.total} cached jobs? This will force a full re-scrape next time.`,
                        () => deleteAllMut.mutate(),
                      )}
                      disabled={isDeleting}
                      className="flex items-center gap-2 text-xs text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All Cache ({stats.total})
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Job list with individual delete */}
            {stats && stats.total > 0 && (
              <div>
                {/* Source filter for job list */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Browse & Remove</p>
                  <div className="flex gap-1.5 flex-wrap ml-auto">
                    <button type="button"
                      onClick={() => setViewSource(undefined)}
                      className={`badge cursor-pointer text-xs ${!viewSource ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      All
                    </button>
                    {Object.keys(stats.bySource).map((src) => {
                      const cfg = SOURCE_LABELS[src] ?? { label: src, color: 'bg-gray-100 text-gray-600' };
                      return (
                        <button key={src} type="button"
                          onClick={() => setViewSource(src as JobSource)}
                          className={`badge cursor-pointer text-xs ${viewSource === src ? 'bg-primary-600 text-white' : `${cfg.color} hover:opacity-80`}`}>
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {jobsQuery.isLoading ? (
                    <div className="p-4 flex items-center gap-2 text-xs text-gray-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading jobs…
                    </div>
                  ) : jobs.length === 0 ? (
                    <div className="p-4 text-xs text-gray-400 text-center">No jobs for this filter</div>
                  ) : (
                    jobs.map((job) => {
                      const cfg = SOURCE_LABELS[job.source] ?? { label: job.source, color: 'bg-gray-100 text-gray-600' };
                      return (
                        <div key={job._id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 truncate font-medium">{job.title}</p>
                            <p className="text-xs text-gray-400 truncate">{job.company} · {relDate(job.scrapedAt)}</p>
                          </div>
                          <span className={`badge text-xs flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
                          <button
                            type="button"
                            onClick={() => deleteOneMut.mutate(job._id)}
                            disabled={isDeleting}
                            title="Remove from cache"
                            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Showing {jobs.length} of {viewSource ? (stats.bySource[viewSource] ?? 0) : stats.total} jobs
                </p>
              </div>
            )}

            {stats?.total === 0 && (
              <div className="text-center py-6">
                <Shield className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Cache is empty — scrape some jobs to populate it</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
