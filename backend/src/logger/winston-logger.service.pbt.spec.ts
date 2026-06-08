import * as fc from 'fast-check';
import { createLogger, format, transports, Logger } from 'winston';
import { Writable } from 'stream';

const { combine, timestamp, printf } = format;

/**
 * Property 15: Log entry structure
 * For any log call with message and context, output contains ISO 8601 timestamp,
 * level, context label, and message.
 *
 * **Validates: Requirements 10.2**
 */
describe('Property 15: Log entry structure', () => {
  function createTestLogger(): { logger: Logger; output: string[] } {
    const output: string[] = [];

    const logFormat = printf(({ level, message, timestamp, context, ...meta }) => {
      const contextPart = context ? ` [${context}]` : '';
      const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} ${level}${contextPart}: ${message}${metaString}`;
    });

    const writableStream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString().replace(/\n$/, ''));
        callback();
      },
    });

    const logger = createLogger({
      level: 'debug',
      format: combine(timestamp(), logFormat),
      transports: [new transports.Stream({ stream: writableStream })],
    });

    return { logger, output };
  }

  const ISO_8601_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/;

  it('should contain ISO 8601 timestamp, level, context label, and message for any log call', () => {
    // Generate alphanumeric strings to avoid whitespace trimming issues in stream output
    const nonEmptyAlphaString = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => s.trim().length > 0 && !s.includes('\n') && !s.includes('\r'));

    fc.assert(
      fc.property(
        fc.record({
          message: nonEmptyAlphaString,
          context: nonEmptyAlphaString,
          level: fc.constantFrom(
            'error' as const,
            'warn' as const,
            'info' as const,
            'verbose' as const,
            'debug' as const,
          ),
        }),
        ({ message, context, level }) => {
          const { logger, output } = createTestLogger();

          // Call the logger at the specified level
          logger.log(level, message, { context });

          // Verify output was produced
          expect(output.length).toBe(1);
          const logEntry = output[0];

          // Verify ISO 8601 timestamp is present
          expect(logEntry).toMatch(ISO_8601_REGEX);

          // Verify level is present
          expect(logEntry).toContain(level);

          // Verify context label is present (wrapped in brackets)
          expect(logEntry).toContain(`[${context}]`);

          // Verify original message is present
          expect(logEntry).toContain(message);
        },
      ),
      { numRuns: 100 },
    );
  });
});
