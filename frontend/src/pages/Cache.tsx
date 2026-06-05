import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Database, Trash2, RefreshCw, Clock, AlertTriangle,
  CheckCircle, X, Loader2, Shield, Building2, Tag,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getCacheStats, getCacheJobs, deleteAllCache,
  deleteCacheBySource, deleteCacheById,
  type JobSource, type CacheStats, type JobListing,
} from '../services/api';
import { SOURCE_LABELS } from './Jobs';

function relDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (diff < 1)  return 'Just now';
  if (diff < 24) return `${diff}h ago`;
  return `${Math.floor(diff / 24)}d ago`;
}

function ConfirmDialog({ message, onConfirm, onCancel, loading }: {
  message: string; onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700">{message}</p>
        </div>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} disabled={loading} className="btn-secondary text-sm px-4">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Cache() {
  const qc = useQueryClient();
  const [viewSource, setViewSource]     = useState<JobSource | undefined>();
  const [confirmMsg, setConfirmMsg]     = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  const statsQuery = useQuery({
    queryKey: ['cacheStats'],
    queryFn: getCacheStats,
    refetchInterval: 15_000,
  });

  const jobsQuery = useQuery({
    queryKey: ['cacheJobs', viewSource],
    queryFn: () => getCacheJobs({ source: viewSource, limit: 500 }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cacheStats'] });
    qc.invalidateQueries({ queryKey: ['cacheJobs'] });
    qc.invalidateQueries({ queryKey: ['jobs'] });
  };

  const deleteAllMut    = useMutation({ mutationFn: deleteAllCache,                        onSuccess: (r) => { toast.success(`Deleted all ${r.deleted} jobs`); invalidate(); } });
  const deleteSourceMut = useMutation({ mutationFn: (s: JobSource) => deleteCacheBySource(s), onSuccess: (r) => { toast.success(`Deleted ${r.deleted} jobs`); invalidate(); } });
  const deleteOneMut    = useMutation({ mutationFn: (id: string) => deleteCacheById(id),   onSuccess: () => { toast.success('Job removed'); invalidate(); } });

  const isDeleting = deleteAllMut.isPending || deleteSourceMut.isPending || deleteOneMut.isPending;

  const confirm = (msg: string, action: () => void) => {
    setConfirmMsg(msg);
    setConfirmAction(() => action);
  };

  const stats: CacheStats | undefined = statsQuery.data;
  const jobs: JobListing[]            = jobsQuery.data ?? [];

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

      <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cache Manager</h1>
            <p className="text-gray-500 mt-1">View, filter and delete stored job listings from the database.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => statsQuery.refetch()} disabled={statsQuery.isFetching}
              className="btn-secondary text-sm">
              <RefreshCw className={`w-4 h-4 ${statsQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {stats && stats.total > 0 && (
              <button type="button"
                onClick={() => confirm(`Delete ALL ${stats.total} cached jobs? This forces a full re-scrape next time.`, () => deleteAllMut.mutate())}
                disabled={isDeleting}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors">
                <Trash2 className="w-4 h-4" /> Clear All ({stats.total})
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        {statsQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading stats…
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Jobs',   value: stats.total,    icon: Database,      color: 'text-gray-600',  bg: 'bg-gray-50',   border: 'border-gray-200' },
              { label: 'Fresh (<24h)', value: stats.fresh24h, icon: CheckCircle,   color: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-200' },
              { label: 'Flagged',      value: stats.flagged,  icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-200' },
              { label: 'Newest',       value: relDate(stats.newest), icon: Clock,  color: 'text-blue-600',  bg: 'bg-blue-50',   border: 'border-blue-200' },
            ].map(({ label, value, icon: Icon, color, bg, border }) => (
              <div key={label} className={`${bg} border ${border} rounded-xl p-4 text-center`}>
                <Icon className={`w-5 h-5 mx-auto mb-2 ${color}`} />
                <p className="text-xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* By-source breakdown with clear buttons */}
        {stats && Object.keys(stats.bySource).length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">By Source</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {Object.entries(stats.bySource).map(([src, count]) => {
                const cfg = SOURCE_LABELS[src as JobSource] ?? { label: src, color: 'bg-gray-100 text-gray-600' };
                return (
                  <div key={src} className="flex items-center gap-4 px-5 py-3">
                    <span className={`badge text-xs flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-sm text-gray-700 flex-1">{count} jobs</span>
                    <button type="button" disabled={isDeleting}
                      onClick={() => confirm(`Delete all ${count} ${cfg.label} jobs from cache?`, () => deleteSourceMut.mutate(src as JobSource))}
                      className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
                      <Trash2 className="w-3.5 h-3.5" /> Clear source
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Job list browser */}
        {stats && stats.total > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 flex-wrap px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">Browse Jobs</h2>
              <div className="flex gap-1.5 flex-wrap ml-auto">
                <button type="button" onClick={() => setViewSource(undefined)}
                  className={`badge cursor-pointer text-xs ${!viewSource ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  All
                </button>
                {Object.keys(stats.bySource).map((src) => {
                  const cfg = SOURCE_LABELS[src as JobSource] ?? { label: src, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <button key={src} type="button" onClick={() => setViewSource(src as JobSource)}
                      className={`badge cursor-pointer text-xs ${viewSource === src ? 'bg-primary-600 text-white' : `${cfg.color} hover:opacity-80`}`}>
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
              {jobsQuery.isLoading ? (
                <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : jobs.length === 0 ? (
                <div className="p-6 text-sm text-gray-400 text-center">No jobs for this filter</div>
              ) : (
                jobs.map((job) => {
                  const cfg = SOURCE_LABELS[job.source] ?? { label: job.source, color: 'bg-gray-100 text-gray-600' };
                  return (
                    <div key={job._id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-sm font-medium text-gray-800 truncate">{job.title}</p>
                        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" />{job.company}
                          </span>
                          {job.location && <span>{job.location}</span>}
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />{relDate(job.scrapedAt)}
                          </span>
                          {job.matchedSkills.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Tag className="w-3 h-3" />{job.matchedSkills.slice(0, 3).join(', ')}
                              {job.matchedSkills.length > 3 && ` +${job.matchedSkills.length - 3}`}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`badge text-xs flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
                      <button type="button" onClick={() => deleteOneMut.mutate(job._id)}
                        disabled={isDeleting} title="Remove this job"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400">
                Showing {jobs.length} of {viewSource ? (stats.bySource[viewSource] ?? 0) : stats.total} jobs
              </p>
            </div>
          </div>
        )}

        {/* Empty cache */}
        {stats?.total === 0 && (
          <div className="card p-12 text-center">
            <Shield className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Cache is empty</p>
            <p className="text-sm text-gray-400 mt-1">Run the Job Scraper to populate it.</p>
          </div>
        )}
      </div>
    </>
  );
}
