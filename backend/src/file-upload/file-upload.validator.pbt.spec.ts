import * as fc from 'fast-check';
import {
  validateFileUpload,
  FileValidationResult,
  MAX_FILE_SIZE,
  VALID_MIMETYPE,
} from './file-upload.validator';

/**
 * Property 2: File upload validation
 * For any file, reject if not PDF or >10MB; accept valid PDFs ≤10MB.
 *
 * **Validates: Requirements 2.3**
 */
describe('Property 2: File upload validation', () => {
  const fileGen = fc.record({
    size: fc.nat({ max: 20_000_000 }),
    mimetype: fc.oneof(
      fc.constant('application/pdf'),
      fc.string(),
    ),
  });

  it('should accept valid PDFs that are ≤10MB', () => {
    fc.assert(
      fc.property(
        fc.record({
          size: fc.nat({ max: MAX_FILE_SIZE }),
          mimetype: fc.constant(VALID_MIMETYPE),
        }),
        (file) => {
          const result = validateFileUpload(file);
          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject files that are not PDFs', () => {
    fc.assert(
      fc.property(
        fc.record({
          size: fc.nat({ max: 20_000_000 }),
          mimetype: fc.string().filter((s) => s !== VALID_MIMETYPE),
        }),
        (file) => {
          const result = validateFileUpload(file);
          expect(result.valid).toBe(false);
          const rejected = result as Extract<FileValidationResult, { valid: false }>;
          expect(rejected.reason).toBe('invalid_file_type');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject PDFs that exceed 10MB', () => {
    fc.assert(
      fc.property(
        fc.record({
          size: fc.integer({ min: MAX_FILE_SIZE + 1, max: 20_000_000 }),
          mimetype: fc.constant(VALID_MIMETYPE),
        }),
        (file) => {
          const result = validateFileUpload(file);
          expect(result.valid).toBe(false);
          const rejected = result as Extract<FileValidationResult, { valid: false }>;
          expect(rejected.reason).toBe('size_exceeded');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should correctly classify any arbitrary file: accept iff PDF and ≤10MB', () => {
    fc.assert(
      fc.property(fileGen, (file) => {
        const result = validateFileUpload(file);
        const isPdf = file.mimetype === VALID_MIMETYPE;
        const isWithinSize = file.size <= MAX_FILE_SIZE;

        if (isPdf && isWithinSize) {
          expect(result.valid).toBe(true);
        } else {
          expect(result.valid).toBe(false);
          const rejected = result as Extract<FileValidationResult, { valid: false }>;
          if (!isPdf) {
            expect(rejected.reason).toBe('invalid_file_type');
          } else {
            expect(rejected.reason).toBe('size_exceeded');
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
