/**
 * Shared fast-check arbitraries (custom generators) for the agent-config
 * property-based test suite.
 */
import * as fc from 'fast-check';
import { INTENT_TABLE } from '../../intent-detector';

// Helper: generate a string from a set of characters with length constraints
function stringFromChars(
  chars: string,
  minLength: number,
  maxLength: number,
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...chars.split('')), { minLength, maxLength })
    .map((arr) => arr.join(''));
}

// --- Email Arbitraries ---

/**
 * Generates valid email strings matching local@domain.tld:
 * - Local part: 1–64 chars, no whitespace
 * - Domain part: 1–253 chars, contains ≥1 dot, no whitespace
 * - No whitespace anywhere
 */
export function validEmail(): fc.Arbitrary<string> {
  const localChars = 'abcdefghijklmnopqrstuvwxyz0123456789._%+-';
  const domainChars = 'abcdefghijklmnopqrstuvwxyz0123456789-';
  const tldChars = 'abcdefghijklmnopqrstuvwxyz';

  const local = stringFromChars(localChars, 1, 30);
  const domainLabel = stringFromChars(domainChars, 1, 20);
  const tld = stringFromChars(tldChars, 2, 6);

  return fc
    .tuple(local, domainLabel, tld)
    .map(([l, d, t]) => `${l}@${d}.${t}`)
    .filter((email) => {
      const atIdx = email.indexOf('@');
      const localPart = email.substring(0, atIdx);
      const domain = email.substring(atIdx + 1);
      return (
        localPart.length >= 1 &&
        localPart.length <= 64 &&
        domain.length >= 1 &&
        domain.length <= 253 &&
        domain.includes('.') &&
        !/\s/.test(email)
      );
    });
}

/**
 * Generates strings that DON'T match the valid email pattern.
 * Strategies: missing @, whitespace, empty local, domain without dot, etc.
 */
export function invalidEmail(): fc.Arbitrary<string> {
  return fc.oneof(
    // No @ sign
    fc.stringMatching(/^[a-z0-9]{1,30}$/).filter((s) => !s.includes('@')),
    // Whitespace in the string
    fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{1,10}$/),
      )
      .map(([a, b]) => `${a} ${b}@domain.com`),
    // Empty local part
    fc.stringMatching(/^[a-z]{1,10}$/).map((d) => `@${d}.com`),
    // Domain without dot
    fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,10}$/),
        fc.stringMatching(/^[a-z]{1,10}$/),
      )
      .map(([l, d]) => `${l}@${d}`),
    // Empty string
    fc.constant(''),
    // Just whitespace
    fc.constantFrom(' ', '\t', '\n', '  ', '\t\t'),
  );
}

// --- PDF File Reference Arbitraries ---

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Generates { filename, size } where filename ends .pdf and size ≤10MB.
 */
export function pdfFileRef(): fc.Arbitrary<{ filename: string; size: number }> {
  const baseName = stringFromChars(
    'abcdefghijklmnopqrstuvwxyz0123456789_-',
    1,
    30,
  );
  const extension = fc.constantFrom('.pdf', '.PDF', '.Pdf', '.pDf');

  return fc
    .tuple(baseName, extension, fc.integer({ min: 0, max: MAX_PDF_SIZE }))
    .map(([name, ext, size]) => ({
      filename: `${name}${ext}`,
      size,
    }));
}

/**
 * Generates file refs with wrong extension or >10MB size.
 */
export function invalidPdfFileRef(): fc.Arbitrary<{
  filename: string;
  size: number;
}> {
  return fc.oneof(
    // Wrong extension with valid size
    fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,20}$/),
        fc.constantFrom('.doc', '.txt', '.png', '.jpg', '.docx', '.xlsx', ''),
        fc.integer({ min: 0, max: MAX_PDF_SIZE }),
      )
      .map(([name, ext, size]) => ({ filename: `${name}${ext}`, size })),
    // Valid .pdf extension but >10MB
    fc
      .tuple(
        fc.stringMatching(/^[a-z]{1,20}$/),
        fc.integer({ min: MAX_PDF_SIZE + 1, max: MAX_PDF_SIZE * 5 }),
      )
      .map(([name, size]) => ({ filename: `${name}.pdf`, size })),
  );
}

// --- MongoDB ObjectId Arbitrary ---

/**
 * Generates valid 24 hex character strings (MongoDB ObjectId format).
 */
export function mongoObjectId(): fc.Arbitrary<string> {
  return stringFromChars('0123456789abcdef', 24, 24);
}

// --- User Profile Data Arbitrary ---

/**
 * Generates { name, headline?, skills, experience? } for template generation.
 */
export function userProfileData(): fc.Arbitrary<{
  name: string;
  headline?: string;
  skills: string[];
  experience?: { company: string; title: string }[];
}> {
  const nonEmptyString = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,30}$/)
    .filter((s) => s.trim().length > 0);

  return fc.record({
    name: nonEmptyString,
    headline: fc.option(nonEmptyString, { nil: undefined }),
    skills: fc.array(nonEmptyString, { minLength: 1, maxLength: 10 }),
    experience: fc.option(
      fc.array(
        fc.record({
          company: nonEmptyString,
          title: nonEmptyString,
        }),
        { minLength: 0, maxLength: 5 },
      ),
      { nil: undefined },
    ),
  });
}

// --- Recipient Context Arbitrary ---

/**
 * Generates { name, title, company } — all non-empty strings.
 */
export function recipientContext(): fc.Arbitrary<{
  name: string;
  title: string;
  company: string;
}> {
  const nonEmptyString = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,30}$/)
    .filter((s) => s.trim().length > 0);

  return fc.record({
    name: nonEmptyString,
    title: nonEmptyString,
    company: nonEmptyString,
  });
}

// --- Intent Request String Arbitrary ---

/**
 * Generates request strings containing keywords from a specific intent category.
 * The generated string will include at least one keyword from the specified category.
 */
export function intentRequestString(category?: string): fc.Arbitrary<string> {
  const entries = category
    ? INTENT_TABLE.filter((e) => e.category === category)
    : INTENT_TABLE;

  if (entries.length === 0) {
    return fc.stringMatching(/^[a-z ]{5,50}$/);
  }

  const allKeywords = entries.flatMap((e) => e.keywords);

  return fc
    .tuple(
      fc.constantFrom(...allKeywords),
      fc.stringMatching(/^[a-z ]{0,20}$/),
      fc.stringMatching(/^[a-z ]{0,20}$/),
    )
    .map(([keyword, prefix, suffix]) =>
      `${prefix} ${keyword} ${suffix}`.trim(),
    );
}

/**
 * Generates request strings that do NOT match any keyword from the intent table.
 */
export function noMatchRequestString(): fc.Arbitrary<string> {
  const allKeywords = INTENT_TABLE.flatMap((e) => e.keywords);

  return fc
    .stringMatching(/^[a-z ]{1,60}$/)
    .filter((s) => {
      const lower = s.toLowerCase();
      return !allKeywords.some((kw) => lower.includes(kw));
    });
}
