/**
 * Validators — implements email validation, PDF validation, and
 * required field validation per skill as defined in validation.rules.md.
 */

// --- Email Validation (Rule 1) ---

/**
 * Validates an email string against the pattern local@domain.tld:
 * - Local part: 1–64 characters, no whitespace
 * - Domain part: 1–253 characters, contains ≥1 dot, no whitespace
 * - Entire string contains no whitespace characters
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  // No whitespace anywhere
  if (/\s/.test(email)) return false;

  const atIndex = email.indexOf('@');
  if (atIndex === -1) return false;

  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);

  // Local part: 1-64 chars, no whitespace (already checked above)
  if (local.length < 1 || local.length > 64) return false;

  // Domain part: 1-253 chars, contains ≥1 dot, no whitespace
  if (domain.length < 1 || domain.length > 253) return false;
  if (!domain.includes('.')) return false;

  return true;
}

/**
 * Partitions a list of email strings into valid and invalid sets.
 * Every email appears in exactly one set (no overlap, complete coverage).
 */
export function partitionEmails(emails: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const email of emails) {
    if (isValidEmail(email)) {
      valid.push(email);
    } else {
      invalid.push(email);
    }
  }

  return { valid, invalid };
}

// --- PDF Validation (Rule 2) ---

export interface FileRef {
  filename: string;
  size: number;
}

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB in bytes

/**
 * Validates a file reference:
 * - Filename ends in .pdf (case-insensitive)
 * - Size ≤ 10MB (10,485,760 bytes)
 */
export function isValidPdf(fileRef: FileRef): boolean {
  if (!fileRef || typeof fileRef.filename !== 'string') return false;
  if (typeof fileRef.size !== 'number') return false;

  const endsWithPdf = fileRef.filename.toLowerCase().endsWith('.pdf');
  const sizeOk = fileRef.size >= 0 && fileRef.size <= MAX_PDF_SIZE;

  return endsWithPdf && sizeOk;
}

// --- Required Field Validation (Rule 4) ---

export interface ValidationFailure {
  ruleNumber: string;
  failingValue: string;
  correctiveAction: string;
}

/**
 * Validates required fields for the PDF extraction skill (Rule 4a).
 * Requires: userId — non-empty string in MongoDB ObjectId format (24 hex chars)
 */
export function validatePdfExtractionFields(input: {
  userId?: string;
}): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  if (
    !input.userId ||
    typeof input.userId !== 'string' ||
    !/^[0-9a-f]{24}$/i.test(input.userId)
  ) {
    failures.push({
      ruleNumber: '4a',
      failingValue: `userId=${input.userId ?? 'missing'}`,
      correctiveAction:
        'Supply a non-empty userId in MongoDB ObjectId format (24 hex chars)',
    });
  }

  return failures;
}

/**
 * Validates required fields for the database storage skill (Rule 4b).
 * Requires: name (non-empty string), email (non-empty string passing email validation)
 */
export function validateDbStorageFields(input: {
  name?: string;
  email?: string;
}): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    failures.push({
      ruleNumber: '4b',
      failingValue: `name=${input.name ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty name string',
    });
  }

  if (
    !input.email ||
    typeof input.email !== 'string' ||
    !isValidEmail(input.email)
  ) {
    failures.push({
      ruleNumber: '4b',
      failingValue: `email=${input.email ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty email in format user@example.com',
    });
  }

  return failures;
}

/**
 * Validates required fields for the email send skill (Rule 4c).
 * Requires: mailIds (array with ≥1 entry passing email validation),
 * subject (non-empty string), context (non-empty string)
 */
export function validateEmailSendFields(input: {
  mailIds?: string[];
  subject?: string;
  context?: string;
}): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  if (!input.mailIds || !Array.isArray(input.mailIds) || input.mailIds.length === 0) {
    failures.push({
      ruleNumber: '4c',
      failingValue: `mailIds=${JSON.stringify(input.mailIds ?? 'missing')}`,
      correctiveAction:
        'Supply mailIds as an array with at least 1 valid email address',
    });
  } else {
    const hasValid = input.mailIds.some((id) => isValidEmail(id));
    if (!hasValid) {
      failures.push({
        ruleNumber: '4c',
        failingValue: `mailIds=[${input.mailIds.join(', ')}]`,
        correctiveAction:
          'At least one entry in mailIds must be a valid email (user@example.com)',
      });
    }
  }

  if (!input.subject || typeof input.subject !== 'string' || input.subject.trim() === '') {
    failures.push({
      ruleNumber: '4c',
      failingValue: `subject=${input.subject ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty subject string',
    });
  }

  if (!input.context || typeof input.context !== 'string' || input.context.trim() === '') {
    failures.push({
      ruleNumber: '4c',
      failingValue: `context=${input.context ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty context string',
    });
  }

  return failures;
}

/**
 * Validates required fields for the template generation skill (Rule 4d).
 * Requires: name (non-empty string), skills (array with ≥1 non-empty entry)
 */
export function validateTemplateGenerationFields(input: {
  name?: string;
  skills?: string[];
}): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    failures.push({
      ruleNumber: '4d',
      failingValue: `name=${input.name ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty name string',
    });
  }

  if (
    !input.skills ||
    !Array.isArray(input.skills) ||
    input.skills.length === 0 ||
    !input.skills.some((s) => typeof s === 'string' && s.trim() !== '')
  ) {
    failures.push({
      ruleNumber: '4d',
      failingValue: `skills=${JSON.stringify(input.skills ?? 'missing')}`,
      correctiveAction: 'Supply skills as an array with at least 1 non-empty entry',
    });
  }

  return failures;
}

/**
 * Validates required fields for the recipient context (Rule 4e).
 * Requires: name (non-empty), title (non-empty), company (non-empty)
 */
export function validateRecipientContext(input: {
  name?: string;
  title?: string;
  company?: string;
}): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    failures.push({
      ruleNumber: '4e',
      failingValue: `recipient.name=${input.name ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty recipient name',
    });
  }

  if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
    failures.push({
      ruleNumber: '4e',
      failingValue: `recipient.title=${input.title ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty recipient title',
    });
  }

  if (
    !input.company ||
    typeof input.company !== 'string' ||
    input.company.trim() === ''
  ) {
    failures.push({
      ruleNumber: '4e',
      failingValue: `recipient.company=${input.company ?? 'missing'}`,
      correctiveAction: 'Supply a non-empty recipient company',
    });
  }

  return failures;
}
