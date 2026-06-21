import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Send, Loader2, ChevronDown, ChevronUp, Sparkles,
  Clock, AlertCircle, Wrench,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  sendAgentMessage,
  getAgentRunStatus,
  getAgentJournal,
  type AgentRunResult,
  type AgentJournalEntry,
} from '../services/api';

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

const TRIGGER_LABEL: Record<string, string> = {
  user_chat: 'Asked',
  autonomous: 'Autonomous',
};

function ActionsList({ actions }: { actions: AgentRunResult['actions'] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (!actions || actions.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      {actions.map((action, i) => (
        <div key={i} className="border border-gray-100 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
          >
            <span className="flex items-center gap-2 text-gray-700 font-medium">
              <Wrench className="w-3.5 h-3.5 text-primary-500" />
              {action.tool}
              <span className="text-gray-400 font-normal">{action.durationMs}ms</span>
            </span>
            {openIndex === i ? (
              <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            )}
          </button>
          {openIndex === i && (
            <div className="px-3 pb-3 space-y-2 text-xs">
              <div>
                <p className="text-gray-400 mb-1">Args</p>
                <pre className="bg-gray-50 rounded-md p-2 overflow-x-auto text-gray-600">
                  {JSON.stringify(action.args, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-gray-400 mb-1">Result</p>
                <pre className="bg-gray-50 rounded-md p-2 overflow-x-auto text-gray-600">
                  {JSON.stringify(action.result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function JournalCard({ entry }: { entry: AgentJournalEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="badge bg-gray-100 text-gray-600 text-xs">
              {TRIGGER_LABEL[entry.trigger] ?? entry.trigger}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              {relativeDate(entry.timestamp)}
            </span>
          </div>
          <p className="text-sm text-gray-900 font-medium truncate">{entry.userMessage}</p>
        </div>
      </div>

      <p className="text-sm text-gray-600">{entry.summary || entry.agentResponse}</p>

      {entry.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {entry.error}
        </p>
      )}

      {entry.actions?.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Hide' : 'Show'} {entry.actions.length} tool call{entry.actions.length !== 1 ? 's' : ''}
        </button>
      )}
      {expanded && <ActionsList actions={entry.actions} />}
    </div>
  );
}

export default function Agent() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AgentRunResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const journalQuery = useQuery({
    queryKey: ['agentJournal'],
    queryFn: () => getAgentJournal({ limit: 20 }),
  });

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setLastResult(null);
    setLastError(null);

    try {
      const { jobId, status } = await sendAgentMessage(trimmed);

      if (status === 'already_running') {
        toast('An agent run is already in progress for you — wait for it to finish.', { icon: '⏳' });
        setSending(false);
        return;
      }

      setActiveJobId(jobId);
      setMessage('');

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await getAgentRunStatus(jobId);

          if (statusRes.state === 'completed') {
            stopPolling();
            setSending(false);
            setActiveJobId(null);
            setLastResult(statusRes.result);
            queryClient.invalidateQueries({ queryKey: ['agentJournal'] });
          } else if (statusRes.state === 'failed') {
            stopPolling();
            setSending(false);
            setActiveJobId(null);
            setLastError(statusRes.failedReason ?? 'The agent run failed.');
            queryClient.invalidateQueries({ queryKey: ['agentJournal'] });
          }
        } catch {
          stopPolling();
          setSending(false);
          setActiveJobId(null);
          setLastError('Lost track of the agent run — check Recent Activity below.');
        }
      }, 2500);
    } catch (err: any) {
      setSending(false);
      setLastError(err?.response?.data?.message ?? 'Could not reach the agent.');
    }
  };

  const entries = journalQuery.data?.entries ?? [];

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bot className="w-6 h-6 text-primary-600" />
          AI Agent
        </h1>
        <p className="text-gray-500 mt-1">
          Ask it to search jobs, check matches, apply, or follow up on outreach.
        </p>
      </div>

      {/* Composer */}
      <div className="card p-4 space-y-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending}
          rows={3}
          placeholder='e.g. "Show me my top 5 job matches" or "Apply to my highest-scoring job"'
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Shift+Enter for a new line</span>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Working…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> Send
              </>
            )}
          </button>
        </div>
        {activeJobId && (
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Agent is reasoning and calling tools — this can take up to a minute.
          </p>
        )}
      </div>

      {/* Latest result */}
      {lastError && (
        <div className="card p-4 border border-red-100 bg-red-50">
          <p className="text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {lastError}
          </p>
        </div>
      )}

      {lastResult && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-primary-600 font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            Agent response
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{lastResult.response}</p>
          <ActionsList actions={lastResult.actions} />
        </div>
      )}

      {/* Recent activity */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Activity</h2>

        {journalQuery.isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card p-4 space-y-3 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
              </div>
            ))}
          </div>
        )}

        {!journalQuery.isLoading && entries.length === 0 && (
          <div className="card p-12 text-center">
            <Bot className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-gray-500 font-medium">No agent runs yet</h3>
            <p className="text-sm text-gray-400 mt-1">
              Send a message above to see the agent's tool calls and decisions show up here.
            </p>
          </div>
        )}

        {entries.length > 0 && (
          <div className="space-y-3">
            {entries.map((entry) => (
              <JournalCard key={entry._id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
