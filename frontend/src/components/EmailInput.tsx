import { useState, KeyboardEvent } from 'react';
import { X, AlertCircle } from 'lucide-react';

interface EmailInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailInput({ emails, onChange, error }: EmailInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const addEmails = (raw: string) => {
    setInputError(null);
    // Try to parse as JSON array first, then comma-separated
    let candidates: string[] = [];
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) candidates = parsed.map(String);
      } catch {
        setInputError('Invalid JSON array format');
        return;
      }
    } else {
      candidates = trimmed.split(',').map((e) => e.trim()).filter(Boolean);
    }

    const invalid = candidates.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length > 0) {
      setInputError(`Invalid email(s): ${invalid.join(', ')}`);
      return;
    }

    const newEmails = candidates.filter((e) => !emails.includes(e));
    onChange([...emails, ...newEmails]);
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) addEmails(inputValue);
    }
    if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) addEmails(inputValue);
  };

  const removeEmail = (email: string) => {
    onChange(emails.filter((e) => e !== email));
  };

  return (
    <div className="space-y-1.5">
      <div
        className={`min-h-[2.75rem] w-full px-3 py-2 bg-white border rounded-lg flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent transition-colors ${
          error || inputError ? 'border-red-400' : 'border-gray-300'
        }`}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 bg-primary-100 text-primary-800 text-xs font-medium px-2.5 py-1 rounded-full"
          >
            {email}
            <button
              type="button"
              onClick={() => removeEmail(email)}
              className="hover:text-primary-600 transition-colors"
              aria-label={`Remove ${email}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="flex-1 min-w-[200px] text-sm outline-none bg-transparent text-gray-900 placeholder-gray-400"
          placeholder={emails.length === 0 ? 'Type email and press Enter or comma...' : 'Add more...'}
        />
      </div>

      <p className="text-xs text-gray-400">
        Press <kbd className="bg-gray-100 px-1 rounded text-gray-600">Enter</kbd> or{' '}
        <kbd className="bg-gray-100 px-1 rounded text-gray-600">,</kbd> to add · Also accepts JSON array
      </p>

      {(error || inputError) && (
        <div className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error || inputError}
        </div>
      )}
    </div>
  );
}
