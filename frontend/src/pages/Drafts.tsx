import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail, Clock, CheckCircle2, XCircle, Edit3, Send,
  Loader2, AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useUserStore } from '../store/userStore';
import {
  getAgentDrafts,
  approveDraft,
  rejectDraft,
  editDraft,
  type AgentDraft,
  type DraftStatus,
} from '../services/api';

const STATUS_CONFIG: Record<DraftStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  pending:  { label: 'Pending',  color: 'bg-blue-100 text-blue-700', icon: Clock },
  edited:   { label: 'Edited',   color: 'bg-indigo-100 text-indigo-700', icon: Edit3 },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700', icon: XCircle },
  sent:     { label: 'Sent',     color: 'bg-emerald-100 text-emerald-700', icon: Send },
  failed:   { label: 'Failed',   color: 'bg-red-100 text-red-700', icon: AlertCircle },
};

function StatusBadge({ status }: { status: DraftStatus }) {
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

function DraftCard({ draft }: { draft: AgentDraft }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(draft.subject);
  const [editBody, setEditBody] = useState(draft.body);

  const approveMutation = useMutation({
    mutationFn: () => approveDraft(draft._id),
    onSuccess: () => {
      toast.success('Draft approved — sending shortly');
      queryClient.invalidateQueries({ queryKey: ['agentDrafts'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectDraft(draft._id),
    onSuccess: () => {
      toast.success('Draft rejected');
      queryClient.invalidateQueries({ queryKey: ['agentDrafts'] });
    },
  });

  const editMutation = useMutation({
    mutationFn: () => editDraft(draft._id, { subject: editSubject, body: editBody }),
    onSuccess: () => {
      toast.success('Draft updated');
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['agentDrafts'] });
    },
  });

  const canAct = draft.status === 'pending' || draft.status === 'edited';
  const isActing = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="card p-4 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {draft.subject}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            To: {draft.recipient}
          </p>
        </div>
        <StatusBadge status={draft.status} />
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {relativeDate(draft.createdAt)}
        </span>
        <span className="capitalize">{draft.type.replace('_', ' ')}</span>
      </div>

      {draft.failureReason && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {draft.failureReason}
        </p>
      )}

      {/* Body preview / expand */}
      <div>
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Hide' : 'Preview'} body
        </button>
        {expanded && !isEditing && (
          <div
            className="mt-2 text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-40 overflow-y-auto prose prose-xs"
            dangerouslySetInnerHTML={{ __html: draft.body }}
          />
        )}
      </div>

      {/* Edit mode */}
      {isEditing && (
        <div className="space-y-2">
          <input
            type="text"
            value={editSubject}
            onChange={(e) => setEditSubject(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="Subject"
            maxLength={200}
          />
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 h-32 resize-y focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="Body"
            maxLength={2000}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending}
              className="btn-primary text-xs"
            >
              {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setIsEditing(false); setEditSubject(draft.subject); setEditBody(draft.body); }}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {canAct && !isEditing && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => approveMutation.mutate()}
            disabled={isActing}
            className="btn-primary text-xs"
          >
            {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Approve & Send
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={isActing}
            className="btn-secondary text-xs"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={() => rejectMutation.mutate()}
            disabled={isActing}
            className="btn-secondary text-xs text-red-600 hover:text-red-700"
          >
            {rejectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export default function Drafts() {
  const { userId } = useUserStore();

  const draftsQuery = useQuery({
    queryKey: ['agentDrafts', userId],
    queryFn: () => getAgentDrafts(),
    enabled: !!userId,
    refetchInterval: 15_000, // Poll every 15s for new drafts
  });

  const drafts = draftsQuery.data ?? [];

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Drafts</h1>
          <p className="text-gray-500 mt-1">Review and approve email drafts created by the AI agent.</p>
        </div>
        {draftsQuery.isFetching && !draftsQuery.isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Refreshing…
          </span>
        )}
      </div>

      {/* Loading state */}
      {draftsQuery.isLoading && (
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
      {!draftsQuery.isLoading && drafts.length === 0 && (
        <div className="card p-12 text-center">
          <Mail className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-500 font-medium">No pending drafts</h3>
          <p className="text-sm text-gray-400 mt-1">
            When the agent drafts emails, they'll appear here for your review.
          </p>
        </div>
      )}

      {/* Drafts grid */}
      {drafts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drafts.map((draft) => (
            <DraftCard key={draft._id} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}
