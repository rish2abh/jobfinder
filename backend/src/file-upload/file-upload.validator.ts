/**
 * Pure file upload validation logic.
 *
 * Validates that:
 * - File mimetype is 'application/pdf'
 * - File size does not exceed 10MB (10 * 1024 * 1024 bytes)
 *
 * Returns a validation result indicating acceptance or rejection with reason.
 */

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
export const VALID_MIMETYPE = 'application/pdf';

export interface FileValidationInput {
  size: number;
  mimetype: string;
}

export type FileValidationResult =
  | { valid: true }
  | { valid: false; reason: 'invalid_file_type' | 'size_exceeded' };

/**
 * Validates an uploaded file for the resume upload endpoint.
 * Rejects files that are not PDFs or exceed 10MB.
 */
export function validateFileUpload(
  file: FileValidationInput,
): FileValidationResult {
  if (file.mimetype !== VALID_MIMETYPE) {
    return { valid: false, reason: 'invalid_file_type' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, reason: 'size_exceeded' };
  }

  return { valid: true };
}
