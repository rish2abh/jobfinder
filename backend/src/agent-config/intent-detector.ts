/**
 * Intent Detection — maps user request strings to skill sequences
 * based on keyword matching from the steering file's intent detection table.
 */

export interface IntentEntry {
  category: string;
  keywords: string[];
  skillSequence: string[];
}

export const INTENT_TABLE: IntentEntry[] = [
  {
    category: 'PDF extraction only',
    keywords: ['parse resume', 'extract pdf', 'parse pdf', 'read resume'],
    skillSequence: ['extract-pdf-data'],
  },
  {
    category: 'Extract + Store',
    keywords: ['parse and save', 'extract and store', 'upload resume'],
    skillSequence: ['extract-pdf-data', 'store-candidates-db'],
  },
  {
    category: 'Email generation + Send',
    keywords: ['send outreach', 'email candidates', 'send email', 'bulk mail'],
    skillSequence: ['generate-email-template', 'send-email'],
  },
  {
    category: 'Full pipeline',
    keywords: ['full pipeline', 'end to end', 'process resume and email'],
    skillSequence: [
      'extract-pdf-data',
      'store-candidates-db',
      'generate-email-template',
      'send-email',
    ],
  },
];

export interface DetectionResult {
  matched: boolean;
  category: string | null;
  skillSequence: string[];
}

/**
 * Detects the intent from a user request string using case-insensitive
 * substring matching against keyword phrases in the intent table.
 *
 * Conflict resolution: when multiple categories match, select the one
 * with the longest skill sequence.
 */
export function detectIntent(request: string): DetectionResult {
  const normalized = request.toLowerCase();

  const matchedEntries = INTENT_TABLE.filter((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword)),
  );

  if (matchedEntries.length === 0) {
    return { matched: false, category: null, skillSequence: [] };
  }

  // Conflict resolution: longest skill sequence wins
  const selected = matchedEntries.reduce((best, current) =>
    current.skillSequence.length > best.skillSequence.length ? current : best,
  );

  return {
    matched: true,
    category: selected.category,
    skillSequence: [...selected.skillSequence],
  };
}
