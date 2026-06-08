/**
 * Template Validator — validates generated email template output:
 * - Subject: non-empty, ≤200 characters, no HTML
 * - Body: non-empty, ≤2000 characters, no HTML
 */

export interface TemplateOutput {
  subject: string;
  body: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
}

const HTML_TAG_REGEX = /<[^>]+>/;

/**
 * Validates a template output:
 * - subject is non-empty and ≤200 characters
 * - body is non-empty and ≤2000 characters
 * - neither contains HTML tags
 */
export function validateTemplateOutput(
  template: TemplateOutput,
): TemplateValidationResult {
  const errors: string[] = [];

  // Subject validation
  if (!template.subject || template.subject.trim() === '') {
    errors.push('Subject must be non-empty');
  } else if (template.subject.length > 200) {
    errors.push(`Subject exceeds 200 characters (got ${template.subject.length})`);
  }

  if (template.subject && HTML_TAG_REGEX.test(template.subject)) {
    errors.push('Subject must not contain HTML tags');
  }

  // Body validation
  if (!template.body || template.body.trim() === '') {
    errors.push('Body must be non-empty');
  } else if (template.body.length > 2000) {
    errors.push(`Body exceeds 2000 characters (got ${template.body.length})`);
  }

  if (template.body && HTML_TAG_REGEX.test(template.body)) {
    errors.push('Body must not contain HTML tags');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
