import { Injectable, LoggerService } from '@nestjs/common';
import { createLogger, format, transports, Logger } from 'winston';

const { combine, timestamp, printf, colorize } = format;

export interface JobLogMeta {
  jobId?: string;
  userId?: string;
  queue?: string;
  durationMs?: number;
  [key: string]: any;
}

@Injectable()
export class WinstonLoggerService implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    const logFormat = printf(({ level, message, timestamp, context, ...meta }) => {
      const contextPart = context ? ` [${context}]` : '';
      const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} ${level}${contextPart}: ${message}${metaString}`;
    });

    this.logger = createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: combine(colorize(), timestamp(), logFormat),
      transports: [new transports.Console()],
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { context, trace });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }

  /**
   * Log a structured message with job metadata (jobId, userId, queue, etc.).
   * Used by BullMQ processors to emit lifecycle events.
   */
  info(message: string, meta: JobLogMeta & { context?: string }) {
    const { context, ...rest } = meta;
    this.logger.info(message, { context, ...rest });
  }

  /**
   * Log a structured error with job metadata and stack trace.
   */
  errorWithMeta(message: string, meta: JobLogMeta & { context?: string; trace?: string }) {
    const { context, trace, ...rest } = meta;
    this.logger.error(message, { context, trace, ...rest });
  }
}
