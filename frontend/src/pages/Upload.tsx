import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload as UploadIcon,
  CheckCircle,
  Loader2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Zap,
  FileText,
  AlertCircle,
  XCircle,
  Code2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import FileUploader from '../components/FileUploader';
import JsonViewer from '../components/JsonViewer';
import {
  uploadResume,
  getResumeParseJobStatus,
  type ResumeParseJobStatus,
  type LlmProvider,
} from '../services/api';
import { useUserStore } from '../store/userStore';

const POLL_INTERVAL_MS = 4000;

type ParseStage =
  | 'idle'
  | 'uploading'
  | 'queued'        // file on Cloudinary, waiting for worker
  | 'parsing'       // worker is calling Ollama
  | 'completed'
  | 'failed';

export default function Upload() {
  const { userId } = useUserStore();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<ParseStage>('idle');
  const [cloudinaryUrl, setCloudinaryUrl] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>('ollama');

  // ── Poll the parse job ─────────────────────────────────────────────────────
  const jobStatusQuery = useQuery<ResumeParseJobStatus>({
    queryKey: ['resumeParseJob', activeJobId],
    queryFn: () => getResumeParseJobStatus(activeJobId!),
    enabled: !!activeJobId && isPolling,

    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (!state) return POLL_INTERVAL_MS;

      if (state === 'completed') {
        setIsPolling(false);
        setStage('completed');
        // Invalidate dashboard so it re-fetches the now-saved JSON
        queryClient.invalidateQueries({ queryKey: ['resume', userId] });
        queryClient.invalidateQueries({ queryKey: ['user', userId] });
        toast.success('Resume parsed and saved — JSON is ready!');
        return false;
      }

      if (state === 'failed') {
        setIsPolling(false);
        setStage('failed');
        toast.error('Parsing failed — see details below.');
        return false;
      }

      // active / waiting / delayed → keep polling
      setStage(state === 'active' ? 'parsing' : 'queued');
      return POLL_INTERVAL_MS;
    },

    retry: false,
  });

  const jobData = jobStatusQuery.data;

  // ── Upload mutation ────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: () =>
      uploadResume({
        userId: userId!,
        file: file!,
        provider,
        onUploadProgress: (pct) => {
          setUploadProgress(pct);
          if (pct === 100) setStage('queued');
        },
      }),
    onMutate: () => {
      setStage('uploading');
      setUploadProgress(0);
      setActiveJobId(null);
      setCloudinaryUrl(null);
    },
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      setCloudinaryUrl(data.cloudinaryUrl);
      setIsPolling(true);
      setFile(null);
      setUploadProgress(0);
      toast.success(`File uploaded — AI parsing started (job #${data.jobId})`);
    },
    onError: () => {
      setStage('idle');
      setUploadProgress(0);
    },
  });

  const isRunning = stage === 'uploading' || stage === 'queued' || stage === 'parsing';

  // ── Status label helpers ───────────────────────────────────────────────────
  const stageLabel: Record<ParseStage, string> = {
    idle:       '',
    uploading:  `Uploading to Cloudinary… ${uploadProgress}%`,
    queued:     'File uploaded — waiting for AI worker…',
    parsing:    `AI parsing with ${provider === 'claude' ? 'Claude' : provider === 'llamaparse' ? 'LlamaParse' : 'Ollama'}… ${jobData?.progress ?? 0}%`,
    completed:  'Parsing complete',
    failed:     'Parsing failed',
  };

  const result = jobData?.result;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload Resume</h1>
        <p className="text-gray-500 mt-1">
          PDF is uploaded instantly. AI parsing runs in the background — you'll see live progress below.
        </p>
      </div>

      {/* Upload card */}
      <div className="card p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Select PDF File</h2>
          <p className="text-sm text-gray-500 mb-4">Max 15 MB · PDF only</p>
          <FileUploader
            onFileSelect={setFile}
            selectedFile={file}
            label="Drag & drop your resume PDF here"
          />
        </div>

        {/* Provider selector */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">AI Provider</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setProvider('ollama')}
              disabled={isRunning}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                provider === 'ollama'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-lg">🦙</span>
              Ollama
              <span className="text-xs text-gray-400 font-normal">(Local)</span>
            </button>
            <button
              type="button"
              onClick={() => setProvider('claude')}
              disabled={isRunning}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                provider === 'claude'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-lg">✨</span>
              Claude
              <span className="text-xs text-gray-400 font-normal">(API)</span>
            </button>
            <button
              type="button"
              onClick={() => setProvider('llamaparse')}
              disabled={isRunning}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                provider === 'llamaparse'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="text-lg">📄</span>
              LlamaParse
              <span className="text-xs text-gray-400 font-normal">(API)</span>
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {provider === 'ollama'
              ? 'Runs locally on your machine — requires Ollama to be running.'
              : provider === 'claude'
              ? 'Uses Anthropic Claude API — requires CLAUDE_API_KEY in backend .env.'
              : 'Uses LlamaParse (LlamaIndex Cloud) — best for complex PDF layouts. Requires LLAMAPARSE_API_KEY.'}
          </p>
        </div>

        {/* Upload progress bar */}
        {stage === 'uploading' && uploadProgress > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Uploading to Cloudinary…</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!file || isRunning}
          className="btn-primary w-full py-2.5"
        >
          {isRunning ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> {stageLabel[stage]}</>
          ) : (
            <><UploadIcon className="w-5 h-5" /> Upload &amp; Parse Resume</>
          )}
        </button>
      </div>

      {/* Pipeline steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { step: '1', title: 'Upload PDF',       desc: 'Stored securely on Cloudinary',         color: 'bg-blue-500',   done: stage !== 'idle' && stage !== 'uploading' },
          { step: '2', title: 'Text Extraction',  desc: 'pdf-parse reads the raw PDF text',       color: 'bg-purple-500', done: stage === 'parsing' || stage === 'completed' || stage === 'failed' },
          { step: '3', title: 'AI Parsing',        desc: `${provider === 'claude' ? 'Claude' : provider === 'llamaparse' ? 'LlamaParse' : 'Ollama'} structures it into clean JSON`,  color: 'bg-green-500',  done: stage === 'completed' },
        ].map(({ step, title, desc, color, done }) => (
          <div key={step} className={`card p-4 text-center transition-all ${done ? 'ring-2 ring-green-400' : ''}`}>
            <div className={`w-8 h-8 ${done ? 'bg-green-500' : color} rounded-full flex items-center justify-center text-white text-sm font-bold mx-auto mb-2 transition-colors`}>
              {done ? '✓' : step}
            </div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500 mt-1">{desc}</p>
          </div>
        ))}
      </div>

      {/* Live job tracker — shown once a job is queued */}
      {activeJobId && stage !== 'idle' && (
        <div className="card overflow-hidden">
          {/* Tracker header */}
          <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200">
            <Zap className="w-4 h-4 text-primary-500" />
            <span className="text-sm font-semibold text-gray-700">Parse Job</span>
            <span className="text-xs text-gray-400 font-mono">#{activeJobId}</span>
            {isPolling && (
              <span className="ml-auto flex items-center gap-1 text-xs text-blue-600">
                <RefreshCw className="w-3 h-3 animate-spin" /> Live
              </span>
            )}
          </div>

          <div className="p-5 space-y-4">
            {/* Ollama progress bar */}
            {(stage === 'queued' || stage === 'parsing') && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{stageLabel[stage]}</span>
                  <span>{jobData?.progress ?? 0}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary-500 h-2 rounded-full transition-all duration-700"
                    style={{ width: `${jobData?.progress ?? 5}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  {provider === 'claude'
                    ? 'Claude typically responds in 5–15 seconds.'
                    : provider === 'llamaparse'
                    ? 'LlamaParse processes PDFs in 10–30 seconds for best structural extraction.'
                    : 'Ollama can take 10–30 seconds on a mid-range laptop. Hang tight…'}
                </p>
              </div>
            )}

            {/* Completed state */}
            {stage === 'completed' && result && (
              <div className="space-y-4">
                {/* Success banner */}
                <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Resume parsed successfully</p>
                    <p className="text-xs text-green-600">
                      Ollama took {result.llmAttempts} attempt{result.llmAttempts > 1 ? 's' : ''} · JSON saved to your profile
                    </p>
                  </div>
                </div>

                {/* Cloudinary URL */}
                {result.cloudinaryUrl && (
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-500 font-medium shrink-0">PDF:</span>
                    <a
                      href={result.cloudinaryUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-600 hover:underline truncate text-xs"
                    >
                      {result.cloudinaryUrl}
                    </a>
                  </div>
                )}

                {/* Parsed field badges */}
                {result.parsedJson && Object.keys(result.parsedJson).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                      Extracted fields
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(result.parsedJson)
                        .filter(([, v]) => {
                          // Only show fields that have real data (not null / empty)
                          if (v === null || v === undefined) return false;
                          if (Array.isArray(v)) return v.length > 0;
                          if (typeof v === 'object') return Object.keys(v).length > 0;
                          if (typeof v === 'string') return v.trim().length > 0;
                          return true;
                        })
                        .map(([key]) => (
                          <span key={key} className="badge bg-primary-100 text-primary-700">
                            {key}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {/* ── Inline JSON preview ── */}
                {result.parsedJson && Object.keys(result.parsedJson).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Code2 className="w-4 h-4 text-gray-400" />
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Parsed JSON preview
                      </p>
                    </div>
                    {/* Show a _parseError warning if Ollama fallback was used */}
                    {'_parseError' in result.parsedJson && (
                      <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          Ollama couldn't produce valid JSON after 3 attempts — partial fallback data is shown.
                          You can re-upload or try re-parsing.
                        </span>
                      </div>
                    )}
                    <JsonViewer
                      data={result.parsedJson}
                      title="Parsed JSON — from this upload"
                    />
                  </div>
                )}

                {/* CTA row */}
                <div className="flex gap-3 pt-1 flex-wrap">
                  <Link to="/dashboard" className="btn-primary">
                    View on Dashboard <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link to="/dashboard/bulk-mail" className="btn-secondary">
                    Send Bulk Mail
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setStage('idle');
                      setActiveJobId(null);
                      setIsPolling(false);
                    }}
                    className="btn-secondary"
                  >
                    Upload another
                  </button>
                </div>
              </div>
            )}

            {/* Failed state */}
            {stage === 'failed' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                  <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-800">Parsing failed</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      {jobData?.failedReason ?? 'Unknown error — check that Ollama is running locally.'}
                    </p>
                  </div>
                </div>

                {cloudinaryUrl && (
                  <p className="text-xs text-gray-500">
                    Your PDF was uploaded successfully to Cloudinary — only the AI step failed.
                    You can try re-parsing without re-uploading from the dashboard.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => { setStage('idle'); setActiveJobId(null); }}
                  className="btn-secondary text-sm"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Re-upload warning */}
      <div className="flex items-start gap-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          Uploading a new resume will <strong>replace</strong> your existing one. The old version is
          archived in your profile history.
        </p>
      </div>
    </div>
  );
}
