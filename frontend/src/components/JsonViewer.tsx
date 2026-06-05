import { useState } from 'react';
import { Copy, Check, ChevronRight, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

interface JsonViewerProps {
  data: Record<string, unknown>;
  title?: string;
}

function JsonNode({
  keyName,
  value,
  depth = 0,
}: {
  keyName?: string;
  value: unknown;
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(depth < 2);

  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isExpandable = isObject || isArray;

  const renderValue = () => {
    if (value === null) return <span className="text-gray-400">null</span>;
    if (typeof value === 'boolean')
      return <span className="text-purple-600">{String(value)}</span>;
    if (typeof value === 'number')
      return <span className="text-blue-600">{value}</span>;
    if (typeof value === 'string')
      return <span className="text-green-700">"{value}"</span>;
    return null;
  };

  if (isExpandable) {
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>);
    const bracketOpen = isArray ? '[' : '{';
    const bracketClose = isArray ? ']' : '}';

    return (
      <div>
        <button
          type="button"
          onClick={() => setIsOpen((p) => !p)}
          className="flex items-center gap-1 hover:bg-gray-100 rounded px-1 -ml-1 text-left w-full group"
        >
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
          )}
          {keyName !== undefined && (
            <span className="text-rose-600 font-medium">"{keyName}"</span>
          )}
          {keyName !== undefined && <span className="text-gray-500">:</span>}
          <span className="text-gray-700">{bracketOpen}</span>
          {!isOpen && (
            <span className="text-gray-400 text-xs ml-1">
              {entries.length} {entries.length === 1 ? 'item' : 'items'}
            </span>
          )}
          {!isOpen && <span className="text-gray-700">{bracketClose}</span>}
        </button>

        {isOpen && (
          <div className="ml-4 border-l border-gray-200 pl-3 space-y-1 mt-1">
            {entries.map(([k, v]) => (
              <JsonNode key={k} keyName={isArray ? undefined : k} value={v} depth={depth + 1} />
            ))}
          </div>
        )}
        {isOpen && <span className="text-gray-700 pl-1">{bracketClose}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-1 px-1">
      {keyName !== undefined && (
        <>
          <span className="text-rose-600 font-medium">"{keyName}"</span>
          <span className="text-gray-500">:</span>
        </>
      )}
      {renderValue()}
    </div>
  );
}

export default function JsonViewer({ data, title = 'Parsed JSON' }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-500" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" /> Copy JSON
            </>
          )}
        </button>
      </div>
      <div className="p-4 overflow-auto max-h-[500px] text-sm font-mono">
        <JsonNode value={data} depth={0} />
      </div>
    </div>
  );
}
