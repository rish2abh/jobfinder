import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  RefreshCw,
  Loader2,
  Building2,
  MapPin,
  AlertTriangle,
  Briefcase,
  ExternalLink,
  TrendingUp,
} from 'lucide-react';
import {
  getMatchScores,
  recomputeScores,
  getMatchingStatus,
  type MatchScore,
} from '../services/api';
import { useUserStore } from '../store/userStore';
import toast from 'react-hot-toast';

const PAGE_SIZE = 20;

function scoreColor(score: number) {
  if (score >= 70) return 'bg-green-100 text-green-700 border-green-200';
  if (score >= 40) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function ScoreCard({ match }: { match: MatchScore }) {
  const job = match.job;
  const applyLink = job?.applyUrl || job?.scrapeUrl;

  return (
    <div className="card p-5 space-y-3 hover:shadow-md transition-shadow flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 leading-tight">
            {job?.title ?? 'Unknown Job'}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500">
            <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{job?.company ?? 'Unknown'}</span>
          </div>
        </div>
        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-sm font-bold ${scoreColor(match.finalScore)}`}>
          <TrendingUp className="w-3.5 h-3.5" />
          {match.finalScore}%
        </div>
      </div>

      {/* Location */}
      {job?.location && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <MapPin className="w-3 h-3" />
          <span>{job.location}</span>
        </div>
      )}

      {/* Score breakdown */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <span className="text-gray-400 block">Cosine Similarity</span>
          <span className="font-semibold text-gray-700">{(match.cosineSimilarity * 100).toFixed(1)}%</span>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <span className="text-gray-400 block">Skill Overlap</span>
          <span className="font-semibold text-gray-700">{(match.skillOverlap * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Degraded indicator */}
      {match.degraded && (
        <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-amber-700">Keyword-only match (vector unavailable)</span>
        </div>
      )}

      {/* Computed at */}
      <div className="text-xs text-gray-400">
        Computed {new Date(match.computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>

      {/* Apply link */}
      <div className="pt-1 mt-auto">
        {applyLink ? (
          <a
            href={applyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-xs py-2 w-full justify-center gap-2"
          >
            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
            Apply Now
          </a>
        ) : (
          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 bg-gray-50 rounded-lg py-2 border border-gray-200">
            <Briefcase className="w-3.5 h-3.5" /> No apply link
          </div>
        )}
      </div>
    </div>
  );
}

export default function MatchingPage() {
  const { user } = useUserStore();
  const userId = user?._id;
  const queryClient = useQueryClient();

  const [page, setPage] = useState(0);
  const [recomputeJobId, setRecomputeJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch match scores
  const scoresQuery = useQuery({
    queryKey: ['matchScores', userId, page],
    queryFn: () => getMatchScores(userId!, { skip: page * PAGE_SIZE, limit: PAGE_SIZE }),
    enabled: !!userId,
    retry: false,
  });

  // Recompute mutation
  const recomputeMutation = useMutation({
    mutationFn: () => recomputeScores(userId!),
    onSuccess: (data) => {
      setRecomputeJobId(data.jobId);
      toast.success(`Recomputing scores — invalidated ${data.invalidated} cached scores`);
    },
    onError: () => {
      toast.error('Failed to trigger score recomputation');
    },
  });

  // Poll recompute status
  useEffect(() => {
    if (!recomputeJobId) return;

    pollRef.current = setInterval(async () => {
      try {
        const status = await getMatchingStatus(recomputeJobId);
        if (status.state === 'completed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRecomputeJobId(null);
          toast.success('Scores recomputed successfully');
          queryClient.invalidateQueries({ queryKey: ['matchScores'] });
        } else if (status.state === 'failed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRecomputeJobId(null);
          toast.error(status.failedReason ?? 'Recomputation failed');
        }
      } catch {
        // Silently continue polling
      }
    }, 4000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [recomputeJobId, queryClient]);

  const scores = scoresQuery.data?.scores ?? [];
  const total = scoresQuery.data?.total ?? 0;
  const isRecomputing = recomputeMutation.isPending || !!recomputeJobId;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Matching</h1>
          <p className="text-gray-500 mt-1">
            Your top-matched jobs ranked by AI similarity score.
          </p>
        </div>
        <button
          type="button"
          onClick={() => recomputeMutation.mutate()}
          disabled={isRecomputing || !userId}
          className="btn-primary text-sm gap-2"
        >
          {isRecomputing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {isRecomputing ? 'Recomputing…' : 'Recompute Scores'}
        </button>
      </div>

      {/* Recomputing progress banner */}
      {isRecomputing && (
        <div className="card p-4 flex items-center gap-3 bg-blue-50 border-blue-200">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Recomputing match scores…</p>
            <p className="text-xs text-blue-600">
              This may take a moment. Scores will refresh automatically when complete.
            </p>
          </div>
        </div>
      )}

      {/* Stats summary */}
      {!scoresQuery.isLoading && total > 0 && (
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" />
            {total} matched job{total !== 1 ? 's' : ''}
          </span>
          {scores.length > 0 && (
            <span className="text-gray-400">
              Top score: <span className="font-semibold text-gray-700">{scores[0].finalScore}%</span>
            </span>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {scoresQuery.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-10 bg-gray-200 rounded" />
                <div className="h-10 bg-gray-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!scoresQuery.isLoading && scores.length === 0 && (
        <div className="card p-12 text-center">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-500 font-medium">No match scores yet</h3>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Upload your resume and scrape jobs to start seeing AI-powered match scores.
          </p>
          {userId && (
            <button
              type="button"
              onClick={() => recomputeMutation.mutate()}
              disabled={isRecomputing}
              className="btn-primary mx-auto text-sm gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Compute Scores
            </button>
          )}
        </div>
      )}

      {/* Score cards grid */}
      {scores.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scores.map((match) => (
              <ScoreCard key={`${match.userId}-${match.jobId}`} match={match} />
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
