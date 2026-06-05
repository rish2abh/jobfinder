import { useState } from 'react';
import { ExternalLink, Download, FileText, Code2, Eye, AlertCircle } from 'lucide-react';
import JsonViewer from './JsonViewer';
import type { ResumeData } from '../services/api';

const API_BASE = 'http://localhost:3000';

interface ResumeViewerProps {
  data: ResumeData;
}

type Tab = 'preview' | 'json' | 'raw';

/**
 * Returns the backend proxy URL for a Cloudinary PDF.
 *
 * We proxy through our own NestJS backend (/uploads/resume/proxy?url=...)
 * instead of embedding the Cloudinary URL directly.  This solves three problems:
 *
 * 1. Cloudinary sends Content-Disposition: attachment → browser downloads
 *    instead of rendering.  Our proxy forces Content-Disposition: inline.
 *
 * 2. Google Docs Viewer 403 — GDV requires public internet access to the URL,
 *    which fails on restricted/private Cloudinary plans.
 *
 * 3. CORS / X-Frame-Options — same-origin response from our backend means
 *    no cross-origin restrictions inside the iframe.
 */
function proxyUrl(cloudinaryUrl: string): string {
  return `${API_BASE}/uploads/resume/proxy?url=${encodeURIComponent(cloudinaryUrl)}`;
}

export default function ResumeViewer({ data }: ResumeViewerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('preview');
  const [showModal, setShowModal] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'json',    label: 'Parsed JSON', icon: Code2 },
    { id: 'raw',     label: 'Raw Text',    icon: FileText },
  ];

  const hasResume = data.cloudinaryUrl || Object.keys(data.resume ?? {}).length > 0;

  if (!hasResume && !data.rawText) {
    return (
      <div className="card p-12 text-center">
        <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-gray-500 font-medium">No resume uploaded yet</h3>
        <p className="text-sm text-gray-400 mt-1">Upload a PDF to see it parsed here</p>
      </div>
    );
  }

  const pdfProxyUrl = data.cloudinaryUrl ? proxyUrl(data.cloudinaryUrl) : null;

  return (
    <>
      <div className="card overflow-hidden">

        {/* ── Tab bar + action buttons ─────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50 flex-wrap gap-3">
          <div className="flex gap-1 bg-gray-200 rounded-lg p-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {data.cloudinaryUrl && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="btn-secondary text-xs py-1.5"
              >
                <Eye className="w-3.5 h-3.5" /> Full Preview
              </button>
              <a
                href={pdfProxyUrl!}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs py-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              <a
                href={data.cloudinaryUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs py-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Cloudinary
              </a>
            </div>
          )}
        </div>

        {/* ── Content area ────────────────────────────────────────────── */}
        <div>

          {/* Preview tab */}
          {activeTab === 'preview' && (
            <>
              {pdfProxyUrl && !iframeError ? (
                <div className="bg-gray-100" style={{ height: '680px' }}>
                  <iframe
                    key={pdfProxyUrl}
                    src={pdfProxyUrl}
                    className="w-full h-full border-0"
                    title="Resume PDF Preview"
                    onError={() => setIframeError(true)}
                  />
                </div>
              ) : iframeError ? (
                /* Fallback when iframe fails — show direct link */
                <div className="p-10 text-center space-y-4">
                  <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
                  <p className="text-gray-600 font-medium">
                    Could not render the PDF inline.
                  </p>
                  <p className="text-sm text-gray-400">
                    Make sure the backend is running on{' '}
                    <code className="bg-gray-100 px-1 rounded">localhost:3000</code>.
                  </p>
                  <div className="flex justify-center gap-3">
                    <a
                      href={pdfProxyUrl!}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary text-sm"
                    >
                      <ExternalLink className="w-4 h-4" /> Open PDF in new tab
                    </a>
                    <button
                      type="button"
                      onClick={() => setIframeError(false)}
                      className="btn-secondary text-sm"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-400">
                  <FileText className="w-10 h-10 mx-auto mb-2" />
                  <p>No PDF available for preview</p>
                </div>
              )}
            </>
          )}

          {/* JSON tab */}
          {activeTab === 'json' && (
            <div className="p-5">
              {data.resume && Object.keys(data.resume).length > 0 ? (
                <div className="space-y-3">
                  {'_parseError' in data.resume && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        Ollama couldn't produce valid JSON after all retry attempts —
                        partial fallback data shown below. Re-upload your PDF or use
                        the re-parse option after verifying Ollama is running.
                      </span>
                    </div>
                  )}
                  <JsonViewer data={data.resume} title="Structured Resume Data" />
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-400 text-sm">No parsed JSON available yet.</p>
                  <p className="text-xs text-gray-300 mt-1">
                    Upload your resume and wait for AI parsing to complete.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Raw text tab */}
          {activeTab === 'raw' && (
            <div className="p-5">
              {data.rawText ? (
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded-lg border border-gray-200 max-h-[500px] overflow-auto leading-relaxed">
                  {data.rawText}
                </pre>
              ) : (
                <p className="text-gray-400 text-sm">No raw text available.</p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Full-screen PDF Modal ──────────────────────────────────────── */}
      {showModal && pdfProxyUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden w-full max-w-5xl h-[92vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <h2 className="font-semibold text-gray-900 text-sm">Resume Preview</h2>
              <div className="flex items-center gap-3">
                <a
                  href={pdfProxyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> Open in tab
                </a>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
                  aria-label="Close modal"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal iframe */}
            <div className="flex-1 bg-gray-100 overflow-hidden">
              <iframe
                key={`modal-${pdfProxyUrl}`}
                src={pdfProxyUrl}
                className="w-full h-full border-0"
                title="Full Resume Preview"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
