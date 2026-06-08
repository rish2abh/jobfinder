import { Page } from 'playwright';
import { SkippedField } from './auto-apply.types';

/**
 * Known field mapping keywords.
 * Each key is a profile field; values are case-insensitive patterns
 * matched against label text, input name, or placeholder attributes.
 */
export const FIELD_MAPPINGS: Record<string, string[]> = {
  name: ['name', 'full name', 'your name', 'applicant name', 'first name', 'last name'],
  email: ['email', 'e-mail', 'email address', 'your email'],
  phone: ['phone', 'mobile', 'telephone', 'contact number', 'phone number'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile'],
  resume: ['resume', 'cv', 'upload resume', 'attach resume', 'upload cv', 'attach cv'],
};

export interface FormFillResult {
  filledCount: number;
  skippedFields: SkippedField[];
  submitted: boolean;
}

interface ProfileData {
  name: string;
  email: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  website?: string;
}

/**
 * Detect which profile field a form input maps to based on its attributes.
 * Returns the profile field key or null if no match.
 */
export function detectFieldMapping(
  label: string,
  inputName: string,
  placeholder: string,
): { profileField: string; matchedBy: 'label' | 'name' | 'placeholder' } | null {
  const candidates = [
    { text: label.toLowerCase().trim(), matchedBy: 'label' as const },
    { text: inputName.toLowerCase().trim(), matchedBy: 'name' as const },
    { text: placeholder.toLowerCase().trim(), matchedBy: 'placeholder' as const },
  ];

  for (const { text, matchedBy } of candidates) {
    if (!text) continue;

    for (const [profileField, patterns] of Object.entries(FIELD_MAPPINGS)) {
      for (const pattern of patterns) {
        if (text.includes(pattern)) {
          return { profileField, matchedBy };
        }
      }
    }
  }

  return null;
}

/**
 * Auto-fill form fields on the page using the user's profile data.
 * Returns a result with filled count and skipped fields.
 */
export async function fillFormFields(
  page: Page,
  profileData: ProfileData,
  resumeUrl?: string,
): Promise<FormFillResult> {
  const skippedFields: SkippedField[] = [];
  let filledCount = 0;

  // Get all visible input/textarea/select elements
  const fields = await page.$$('input:visible, textarea:visible, select:visible');

  for (const field of fields) {
    const tagName = await field.evaluate((el) => el.tagName.toLowerCase());
    const inputType = await field.getAttribute('type') ?? 'text';

    // Skip submit/hidden/button types
    if (['submit', 'hidden', 'button', 'reset', 'image'].includes(inputType)) continue;

    // Gather field identifiers
    const inputName = (await field.getAttribute('name')) ?? '';
    const placeholder = (await field.getAttribute('placeholder')) ?? '';
    const ariaLabel = (await field.getAttribute('aria-label')) ?? '';
    const id = (await field.getAttribute('id')) ?? '';

    // Try to find associated label
    let labelText = ariaLabel;
    if (!labelText && id) {
      const label = await page.$(`label[for="${id}"]`);
      if (label) {
        labelText = (await label.textContent()) ?? '';
      }
    }
    if (!labelText) {
      // Check if wrapped in a label
      const parentLabel = await field.evaluate((el) => {
        const label = el.closest('label');
        return label?.textContent ?? '';
      });
      labelText = parentLabel;
    }

    const mapping = detectFieldMapping(labelText, inputName, placeholder);

    if (!mapping) {
      // Only report non-trivial fields (skip checkboxes, radios for non-required)
      if (!['checkbox', 'radio'].includes(inputType)) {
        const fieldIdentifier = labelText || inputName || placeholder || id || `unknown-${tagName}`;
        skippedFields.push({ fieldIdentifier, reason: 'requires_manual_review' });
      }
      continue;
    }

    // Fill based on the mapped profile field
    try {
      switch (mapping.profileField) {
        case 'name':
          await field.fill(profileData.name);
          filledCount++;
          break;
        case 'email':
          await field.fill(profileData.email);
          filledCount++;
          break;
        case 'phone':
          if (profileData.phone) {
            await field.fill(profileData.phone);
            filledCount++;
          }
          break;
        case 'linkedin':
          if (profileData.linkedin) {
            await field.fill(profileData.linkedin);
            filledCount++;
          }
          break;
        case 'resume':
          // Handle file upload
          if (inputType === 'file' && resumeUrl) {
            // For file inputs, we need a local file path or downloaded file
            // Skip if we only have a URL — mark as skipped
            skippedFields.push({ fieldIdentifier: 'resume upload', reason: 'requires_manual_review' });
          }
          break;
        default:
          break;
      }
    } catch {
      // Field interaction failed — skip
      const fieldIdentifier = labelText || inputName || placeholder || id;
      skippedFields.push({ fieldIdentifier, reason: 'requires_manual_review' });
    }
  }

  return { filledCount, skippedFields, submitted: false };
}
