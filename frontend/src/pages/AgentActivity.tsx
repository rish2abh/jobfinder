import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Clock, Cpu, Loader2,
  ChevronDown, ChevronUp, Wrench, Zap,
} from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { getAgentJournal, type JournalEntry } from '../services/api';

const PAGE_SIZE = 20;

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

function JournalCard({ entry }: { entry: JournalEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card p-4 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 line-clamp-2">
            {entry.userMessage}
          </p>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
            {entry.agentResponse.slice(0, 150)}{entry.agentResponse.length > 150 ? '…' : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {relativeDate(entry.timestamp)}
        </span>
        <span className="flex items-center gap-1">
          <Wrench className="w-3 h-3" />
          {entry.actions.length} tool call{entry.actions.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {entry.iterations} iter
        </span>
        <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
        {entry.tokenUsage && (
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            {entry.tokenUsage.total.toLocaleString()} tokens
          </span>
        )}
      </div>

      {entry.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {entry.error}
        </p>
      )}

      {entry.actions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? 'Hide' : 'Show'} tool calls
          </button>
          {expanded && (
            <div className="mt-2 space-y-2">
              {entry.actions.map((action, i) => (
                <div key={i} className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-gray-700">{action.tool}</span>
                    <span className="text-gray-400">{action.durationMs}ms</span>
                  </div>
                  <pre className="mt-1 text-gray-500 overflow-x-auto whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                    {JSON.stringify(action.args, null, 2).slice(0, 500)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentActivity() {
  const { userId } = useUserStore();
  const [page, setPage] = useState(0);

  const journalQuery = useQuery({
    queryKey: ['agentJournal', userId, page],
    queryFn: () => getAgentJournal({ skip: page * PAGE_SIZE, limit: PAGE_SIZE }),
    enabled: !!userId,
  });

  const entries = journalQuery.data?.entries ?? [];
  const total = journalQuery.data?.total ?? 0;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agent Activity</h1>
          <p className="text-gray-500 mt-1">History of AI agent interactions, tool calls, and results.</p>
        </div>
        {journalQuery.isFetching && !journalQuery.isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
          </span>
        )}
      </div>

      {/* Loading state */}
      {journalQuery.isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-full" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!journalQuery.isLoading && entries.length === 0 && (
        <div className="card p-12 text-center">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-500 font-medium">No agent activity yet</h3>
          <p className="text-sm text-gray-400 mt-1">
            Start a conversation with the AI agent to see activity here.
          </p>
        </div>
      )}

      {/* Journal entries */}
      {entries.length > 0 && (
        <>
          <div className="space-y-4">
            {entries.map((entry) => (
              <JournalCard key={entry._id} entry={entry} />
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
