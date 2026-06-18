import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  Users,
  Mail,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Send,
  Eye,
  Edit3,
  RefreshCw,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useUserStore } from '../store/userStore';
import {
  uploadContacts,
  groupContacts,
  getContactGroups,
  getContacts,
  getSavedTemplates,
  generateTemplates,
  editTemplate,
  triggerBulkSend,
  getBulkSendStatus,
  type ContactUploadResult,
  type ContactGroup,
  type BulkContact,
  type EmailTemplate,
  type BulkSendStatus,
} from '../services/api';

type Step = 'upload' | 'group' | 'templates' | 'approve' | 'sending';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
];
const ACCEPTED_EXTENSIONS = '.pdf,.doc,.docx,.csv';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function ContactsPage() {
  const { userId } = useUserStore();
  const queryClient = useQueryClient();

  // Workflow state
  const [step, setStep] = useState<Step>('upload');
  const [uploadResult, setUploadResult] = useState<ContactUploadResult | null>(null);
  const [groupBy, setGroupBy] = useState<'title' | 'company'>('title');
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<Record<string, EmailTemplate>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [showSavedPicker, setShowSavedPicker] = useState(false);
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<BulkSendStatus | null>(null);

  // ── Fetch existing groups on load to allow resuming ───────────────────────

  const existingGroupsQuery = useQuery({
    queryKey: ['contactGroups'],
    queryFn: () => getContactGroups(),
    enabled: !!userId,
  });

  const existingGroups = existingGroupsQuery.data ?? [];

  // ── Fetch saved templates for "Use Saved Template" option ─────────────────

  const savedTemplatesQuery = useQuery({
    queryKey: ['savedTemplates'],
    queryFn: () => getSavedTemplates(),
    enabled: !!userId,
  });

  const savedTemplates = savedTemplatesQuery.data ?? [];

  // ── Fetch all uploaded contacts ───────────────────────────────────────────

  const contactsQuery = useQuery({
    queryKey: ['allContacts'],
    queryFn: () => getContacts(),
    enabled: !!userId,
  });

  const allContacts = contactsQuery.data ?? [];

  // ── Pagination for contacts table ──────────────────────────────────────────
  const [contactPage, setContactPage] = useState(1);
  const CONTACTS_PER_PAGE = 50;
  const totalContactPages = Math.ceil(allContacts.length / CONTACTS_PER_PAGE);
  const paginatedContacts = allContacts.slice(
    (contactPage - 1) * CONTACTS_PER_PAGE,
    contactPage * CONTACTS_PER_PAGE,
  );

  // ── File Upload ───────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: uploadContacts,
    onSuccess: (data) => {
      setUploadResult(data);
      toast.success(`Parsed ${data.totalParsed} contacts (${data.storedCount} stored)`);
      setStep('group');
    },
  });

  const handleFileUpload = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|doc|docx|csv)$/i)) {
        toast.error('Unsupported file format. Use PDF, DOC, DOCX, or CSV.');
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error('File exceeds 10MB size limit.');
        return;
      }
      uploadMutation.mutate(file);
    },
    [uploadMutation],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      e.target.value = '';
    },
    [handleFileUpload],
  );

  // ── Grouping ──────────────────────────────────────────────────────────────

  const groupMutation = useMutation({
    mutationFn: (mode: 'title' | 'company') => {
      const ids = selectedContactIds.size > 0 ? Array.from(selectedContactIds) : undefined;
      return groupContacts(mode, ids);
    },
    onSuccess: (data) => {
      setGroups(data);
      queryClient.invalidateQueries({ queryKey: ['contactGroups'] });
      toast.success(`Created ${data.length} group${data.length !== 1 ? 's' : ''}`);
      setStep('templates');
    },
  });

  const handleGroup = () => {
    groupMutation.mutate(groupBy);
  };

  // ── Existing groups query ─────────────────────────────────────────────────
  // (moved to top-level existingGroupsQuery)

  // ── Template Generation ───────────────────────────────────────────────────

  const templateMutation = useMutation({
    mutationFn: (groupIds: string[]) => generateTemplates(groupIds),
    onSuccess: (data) => {
      const map: Record<string, EmailTemplate> = {};
      data.forEach((t) => { map[t.groupId] = t; });
      setTemplates(map);
      toast.success(`Generated ${data.length} template${data.length !== 1 ? 's' : ''}`);
      setStep('approve');
    },
  });

  const handleGenerateTemplates = (groupIds?: string[]) => {
    const ids = groupIds ?? groups.map((g) => g._id);
    if (ids.length === 0) {
      toast.error('No groups selected');
      return;
    }
    templateMutation.mutate(ids);
  };

  // ── Template Editing ──────────────────────────────────────────────────────

  const editMutation = useMutation({
    mutationFn: ({ groupId, subject, body }: { groupId: string; subject: string; body: string }) =>
      editTemplate(groupId, subject, body),
    onSuccess: (data) => {
      setTemplates((prev) => ({ ...prev, [data.groupId]: data }));
      setEditingGroup(null);
      toast.success('Template updated');
    },
  });

  const startEdit = (groupId: string) => {
    const t = templates[groupId];
    if (t) {
      setEditSubject(t.subject);
      setEditBody(t.body);
      setEditingGroup(groupId);
    }
  };

  const saveEdit = () => {
    if (!editingGroup) return;
    editMutation.mutate({ groupId: editingGroup, subject: editSubject, body: editBody });
  };

  // ── Bulk Send ─────────────────────────────────────────────────────────────

  // Track which contacts are selected for sending (approve step)
  const [sendContactIds, setSendContactIds] = useState<Set<string>>(new Set());

  // Initialize sendContactIds when entering approve step — select all by default
  const initSendContacts = () => {
    const allIds = new Set<string>();
    groups.forEach((g) => g.contactIds.forEach((id) => allIds.add(id)));
    setSendContactIds(allIds);
  };

  // Auto-initialize when step changes to approve
  useEffect(() => {
    if (step === 'approve') {
      initSendContacts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const sendMutation = useMutation({
    mutationFn: () => {
      const selectedIds = sendContactIds.size > 0 ? Array.from(sendContactIds) : undefined;
      // Only send groups that have at least one selected contact
      const activeGroupIds = groups
        .filter((g) => g.contactIds.some((id) => sendContactIds.has(id)))
        .map((g) => g._id);
      return triggerBulkSend(activeGroupIds, undefined, undefined, selectedIds);
    },
    onSuccess: (data) => {
      setBulkJobId(data.bulkJobId);
      setSendStatus({
        bulkJobId: data.bulkJobId,
        total: data.totalRecipients,
        completed: 0,
        failed: 0,
        active: 0,
        waiting: data.totalRecipients,
      });
      toast.success(`Bulk send started — ${data.totalRecipients} recipients`);
      setStep('sending');
    },
  });

  // ── Status Polling ────────────────────────────────────────────────────────

  useQuery({
    queryKey: ['bulkSendStatus', bulkJobId],
    queryFn: () => getBulkSendStatus(bulkJobId!),
    enabled: !!bulkJobId && step === 'sending',
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.waiting === 0 && data.active === 0) return false;
      return 4000;
    },
    select: (data) => {
      setSendStatus(data);
      return data;
    },
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  const resetWorkflow = () => {
    setStep('upload');
    setUploadResult(null);
    setGroups([]);
    setSelectedContactIds(new Set());
    setSendContactIds(new Set());
    setTemplates({});
    setBulkJobId(null);
    setSendStatus(null);
    setEditingGroup(null);
    setShowSavedPicker(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bulk Contacts</h1>
          <p className="text-gray-500 mt-1">
            Upload contacts, group them, generate personalized emails, and send in bulk.
          </p>
        </div>
        {step !== 'upload' && (
          <button
            type="button"
            onClick={resetWorkflow}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            Start Over
          </button>
        )}
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={step} />

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary-600" />
              Upload Contact File
            </h2>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-primary-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById('contact-file-input')?.click()}
            >
              {uploadMutation.isPending ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
                  <p className="text-sm text-gray-600">Parsing contacts…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-10 h-10 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    Drag & drop or click to upload
                  </p>
                  <p className="text-xs text-gray-400">
                    PDF, DOC, DOCX, or CSV — max 10MB
                  </p>
                </div>
              )}
            </div>
            <input
              id="contact-file-input"
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileInput}
              className="hidden"
            />
          </div>

          {/* Resume previous work */}
          {existingGroups.length > 0 && (
            <div className="card p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary-600" />
                Resume Previous Work
              </h2>
              <p className="text-sm text-gray-500">
                You have {existingGroups.length} existing group{existingGroups.length !== 1 ? 's' : ''} from a previous upload. Pick up where you left off.
              </p>
              <div className="flex flex-wrap gap-2">
                {existingGroups.map((g) => (
                  <span
                    key={g._id}
                    className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full px-3 py-1"
                  >
                    <Users className="w-3 h-3" />
                    {g.groupValue} ({g.contactIds.length})
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setGroups(existingGroups);
                  setStep('templates');
                }}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                Resume with These Groups
              </button>
            </div>
          )}
        </div>
      )}

      {/* Upload Result Summary */}
      {uploadResult && step !== 'upload' && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 className="w-4 h-4" />
              {uploadResult.storedCount} stored
            </span>
            {uploadResult.skippedCount > 0 && (
              <span className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle className="w-4 h-4" />
                {uploadResult.skippedCount} skipped
              </span>
            )}
            {uploadResult.duplicateCount > 0 && (
              <span className="text-gray-500">
                {uploadResult.duplicateCount} duplicates
              </span>
            )}
          </div>

          {/* Parsed contacts preview */}
          {uploadResult.contacts && uploadResult.contacts.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-primary-600 cursor-pointer hover:underline font-medium">
                Preview extracted data ({uploadResult.contacts.length}{uploadResult.totalParsed > 50 ? ` of ${uploadResult.totalParsed}` : ''})
              </summary>
              <div className="mt-2 overflow-x-auto border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Name</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Email</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Title</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Company</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {uploadResult.contacts.map((c, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 text-gray-900">{c.name}</td>
                        <td className="px-2 py-1 text-gray-600">{c.email}</td>
                        <td className="px-2 py-1 text-gray-500">{c.title || '—'}</td>
                        <td className="px-2 py-1 text-gray-500">{c.company || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {uploadResult.skipped.length > 0 && (
            <details>
              <summary className="text-xs text-amber-600 cursor-pointer hover:underline">
                View skipped records ({uploadResult.skipped.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                {uploadResult.skipped.map((s, i) => (
                  <li key={i}>Row {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Step: Grouping */}
      {step === 'group' && (
        <div className="space-y-4">
          {/* Contact list with selection */}
          {allContacts.length > 0 && (
            <div className="card p-6 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary-600" />
                  Your Contacts ({allContacts.length})
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedContactIds.size === allContacts.length) {
                      setSelectedContactIds(new Set());
                    } else {
                      setSelectedContactIds(new Set(allContacts.map((c) => c._id)));
                    }
                  }}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  {selectedContactIds.size === allContacts.length ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {selectedContactIds.size === allContacts.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {selectedContactIds.size > 0 && (
                <p className="text-sm text-primary-600 font-medium">
                  {selectedContactIds.size} contact{selectedContactIds.size !== 1 ? 's' : ''} selected
                </p>
              )}

              <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left w-10"></th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Title</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Company</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedContacts.map((contact) => (
                      <tr
                        key={contact._id}
                        onClick={() => {
                          setSelectedContactIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(contact._id)) next.delete(contact._id);
                            else next.add(contact._id);
                            return next;
                          });
                        }}
                        className={`cursor-pointer hover:bg-gray-50 transition-colors ${
                          selectedContactIds.has(contact._id) ? 'bg-primary-50' : ''
                        }`}
                      >
                        <td className="px-3 py-2">
                          {selectedContactIds.has(contact._id) ? (
                            <CheckSquare className="w-4 h-4 text-primary-600" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-300" />
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">{contact.name}</td>
                        <td className="px-3 py-2 text-gray-600">{contact.email}</td>
                        <td className="px-3 py-2 text-gray-500">{contact.title || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{contact.company || '—'}</td>
                        <td className="px-3 py-2 text-gray-400 text-xs">
                          {new Date(contact.uploadedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalContactPages > 1 && (
                <div className="flex items-center justify-between pt-3">
                  <p className="text-xs text-gray-500">
                    Showing {(contactPage - 1) * CONTACTS_PER_PAGE + 1}–
                    {Math.min(contactPage * CONTACTS_PER_PAGE, allContacts.length)} of{' '}
                    {allContacts.length} contacts
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setContactPage((p) => Math.max(1, p - 1))}
                      disabled={contactPage === 1}
                      className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-gray-600 px-2">
                      Page {contactPage} of {totalContactPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setContactPage((p) => Math.min(totalContactPages, p + 1))}
                      disabled={contactPage === totalContactPages}
                      className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grouping controls */}
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary-600" />
              Group Contacts
            </h2>
            <p className="text-sm text-gray-500">
              Choose how to group your contacts for targeted email templates.
            </p>

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Group by:</label>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'title' | 'company')}
                className="input w-auto"
              >
                <option value="title">Job Title</option>
                <option value="company">Company</option>
              </select>
              <button
                type="button"
                onClick={handleGroup}
                disabled={groupMutation.isPending}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {groupMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Apply Grouping
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Templates */}
      {step === 'templates' && (
        <div className="space-y-4">
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary-600" />
                Contact Groups
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {savedTemplates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSavedPicker(!showSavedPicker)}
                    className="btn-secondary text-sm flex items-center gap-1.5"
                  >
                    <FileText className="w-4 h-4" />
                    Use Saved Template
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    // Initialize empty templates for all groups so user can write manually
                    const map: Record<string, EmailTemplate> = {};
                    groups.forEach((g) => {
                      map[g._id] = { _id: '', groupId: g._id, userId: '', subject: '', body: '', generatedBy: 'manual', cachedAt: '' };
                    });
                    setTemplates(map);
                    setStep('approve');
                  }}
                  className="btn-secondary text-sm flex items-center gap-1.5"
                >
                  <Edit3 className="w-4 h-4" />
                  Write Manually
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateTemplates()}
                  disabled={templateMutation.isPending}
                  className="btn-primary text-sm flex items-center gap-1.5"
                >
                  {templateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  ⚡ Generate with AI
                </button>
              </div>
            </div>

            {/* Saved Templates Picker */}
            {showSavedPicker && savedTemplates.length > 0 && (
              <div className="border border-primary-200 bg-primary-50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-medium text-gray-700">Select a saved template to apply to all groups:</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {savedTemplates.map((t) => (
                    <button
                      key={t._id}
                      type="button"
                      onClick={() => {
                        // Apply this saved template to all groups
                        const map: Record<string, EmailTemplate> = {};
                        groups.forEach((g) => {
                          map[g._id] = { ...t, groupId: g._id };
                        });
                        setTemplates(map);
                        setShowSavedPicker(false);
                        setStep('approve');
                      }}
                      className="w-full text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {t.subject || '(no subject)'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.body}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {t.generatedBy === 'ai'
                          ? `🤖 AI generated${t.aiProvider ? ` (${t.aiProvider === 'groq' ? 'Groq' : 'Ollama'})` : ''}`
                          : '✍️ Manual'} • {t.cachedAt ? new Date(t.cachedAt).toLocaleDateString() : ''}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {groups.length === 0 && (
              <p className="text-sm text-gray-400">No groups found.</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map((group) => (
                <GroupCard
                  key={group._id}
                  group={group}
                  template={templates[group._id]}
                  onGenerate={() => handleGenerateTemplates([group._id])}
                  isGenerating={templateMutation.isPending}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step: Approve */}
      {step === 'approve' && (
        <div className="space-y-4">
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Eye className="w-5 h-5 text-primary-600" />
              Review & Approve
            </h2>
            <p className="text-sm text-gray-500">
              Review generated templates before sending. You can edit any template.
            </p>

            <div className="space-y-4">
              {groups.map((group) => {
                const template = templates[group._id];
                const isEditing = editingGroup === group._id;

                return (
                  <div key={group._id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900 text-sm">
                          {group.groupValue}
                        </h3>
                        <p className="text-xs text-gray-400">
                          {group.contactIds.filter((id) => sendContactIds.has(id)).length}/{group.contactIds.length} recipient{group.contactIds.length !== 1 ? 's' : ''} selected • {group.groupType}
                          {template?.generatedBy === 'ai' && template.aiProvider && (
                            <span className="ml-2 inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5 text-[10px] font-medium">
                              ⚡ {template.aiProvider === 'groq' ? 'Groq' : 'Ollama'}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const groupSelected = group.contactIds.every((id) => sendContactIds.has(id));
                            setSendContactIds((prev) => {
                              const next = new Set(prev);
                              group.contactIds.forEach((id) => {
                                if (groupSelected) next.delete(id);
                                else next.add(id);
                              });
                              return next;
                            });
                          }}
                          className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1"
                        >
                          {group.contactIds.every((id) => sendContactIds.has(id)) ? (
                            <><CheckSquare className="w-3 h-3" /> All</>
                          ) : (
                            <><Square className="w-3 h-3" /> All</>
                          )}
                        </button>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => startEdit(group._id)}
                            className="btn-secondary text-xs flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Recipient selection list */}
                    {allContacts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {group.contactIds.map((contactId) => {
                          const contact = allContacts.find((c) => c._id === contactId);
                          if (!contact) return null;
                          const isSelected = sendContactIds.has(contactId);
                          return (
                            <button
                              key={contactId}
                              type="button"
                              onClick={() => {
                                setSendContactIds((prev) => {
                                  const next = new Set(prev);
                                  if (isSelected) next.delete(contactId);
                                  else next.add(contactId);
                                  return next;
                                });
                              }}
                              className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 transition-colors ${
                                isSelected
                                  ? 'bg-primary-100 text-primary-700 border border-primary-300'
                                  : 'bg-gray-100 text-gray-400 border border-gray-200 line-through'
                              }`}
                            >
                              {isSelected ? (
                                <CheckSquare className="w-3 h-3" />
                              ) : (
                                <Square className="w-3 h-3" />
                              )}
                              {contact.name || contact.email}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {template && !isEditing && (
                      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                        <p className="text-sm font-medium text-gray-700">
                          Subject: {template.subject}
                        </p>
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">
                          {template.body}
                        </p>
                      </div>
                    )}

                    {isEditing && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                          <input
                            type="text"
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            maxLength={200}
                            className="input w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            maxLength={2000}
                            rows={6}
                            className="input w-full resize-y"
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            Use {'{{name}}'}, {'{{company}}'}, {'{{title}}'} for personalization.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={editMutation.isPending}
                            className="btn-primary text-xs flex items-center gap-1"
                          >
                            {editMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingGroup(null)}
                            className="btn-secondary text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {!template && (
                      <p className="text-xs text-amber-600">No template generated for this group.</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Send section */}
            <div className="pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-gray-600">
                  <strong>{sendContactIds.size}</strong> of{' '}
                  <strong>{groups.reduce((sum, g) => sum + g.contactIds.length, 0)}</strong> recipients selected •{' '}
                  <strong>{groups.length}</strong> group{groups.length !== 1 ? 's' : ''}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = new Set<string>();
                      groups.forEach((g) => g.contactIds.forEach((id) => allIds.add(id)));
                      setSendContactIds(allIds);
                    }}
                    className="btn-secondary text-xs"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendContactIds(new Set())}
                    className="btn-secondary text-xs"
                  >
                    Deselect All
                  </button>
                  <button
                    type="button"
                    onClick={() => sendMutation.mutate()}
                    disabled={sendMutation.isPending || sendContactIds.size === 0}
                    className="btn-primary flex items-center gap-2"
                  >
                    {sendMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Send to {sendContactIds.size} Selected
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step: Sending Status */}
      {step === 'sending' && sendStatus && (
        <div className="card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Send className="w-5 h-5 text-primary-600" />
            Bulk Send Status
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{sendStatus.total}</p>
              <p className="text-xs text-gray-500 mt-1">Total</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{sendStatus.completed}</p>
              <p className="text-xs text-gray-500 mt-1">Sent</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{sendStatus.failed}</p>
              <p className="text-xs text-gray-500 mt-1">Failed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{sendStatus.waiting + sendStatus.active}</p>
              <p className="text-xs text-gray-500 mt-1">Remaining</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Progress</span>
              <span>
                {sendStatus.total > 0
                  ? Math.round(((sendStatus.completed + sendStatus.failed) / sendStatus.total) * 100)
                  : 0}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-primary-600 h-2.5 rounded-full transition-all duration-500"
                style={{
                  width: `${sendStatus.total > 0
                    ? ((sendStatus.completed + sendStatus.failed) / sendStatus.total) * 100
                    : 0}%`,
                }}
              />
            </div>
          </div>

          {sendStatus.waiting === 0 && sendStatus.active === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4" />
              Bulk send complete!
            </div>
          )}

          {(sendStatus.waiting > 0 || sendStatus.active > 0) && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending emails… (rate limited to 5/min)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'Upload' },
    { key: 'group', label: 'Group' },
    { key: 'templates', label: 'Templates' },
    { key: 'approve', label: 'Review' },
    { key: 'sending', label: 'Send' },
  ];

  const currentIdx = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium ${
              i < currentIdx
                ? 'bg-green-100 text-green-700'
                : i === currentIdx
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {i < currentIdx ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
          </div>
          <span
            className={`text-xs font-medium hidden sm:inline ${
              i <= currentIdx ? 'text-gray-700' : 'text-gray-400'
            }`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div className={`w-6 h-0.5 ${i < currentIdx ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function GroupCard({
  group,
  template,
  onGenerate,
  isGenerating,
}: {
  group: ContactGroup;
  template?: EmailTemplate;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-gray-900 text-sm">{group.groupValue}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {group.contactIds.length} contact{group.contactIds.length !== 1 ? 's' : ''} • {group.groupType}
          </p>
        </div>
        {!template && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="btn-secondary text-xs flex items-center gap-1"
          >
            {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Generate
          </button>
        )}
      </div>
      {template && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-gray-700 truncate">
            Subject: {template.subject}
          </p>
          <p className="text-xs text-gray-500 line-clamp-2">{template.body}</p>
        </div>
      )}
    </div>
  );
}
