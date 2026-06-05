import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'tls';

/**
 * Builds an ioredis-compatible connection object from UPSTASH_REDIS_URL or REDIS_URL.
 *
 * Upstash Redis URLs look like:
 *   rediss://default:<password>@<host>.upstash.io:6379
 *
 * The "rediss://" scheme means TLS is required.
 */
export function buildRedisConnection(configService: ConfigService): {
  host: string;
  port: number;
  password: string;
  username: string;
  tls: ConnectionOptions;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
} {
  const url = configService.get<string>('UPSTASH_REDIS_URL') || configService.get<string>('REDIS_URL');

  if (!url) {
    throw new Error('UPSTASH_REDIS_URL or REDIS_URL is not set in environment variables');
  }

  const parsed = new URL(url);

  const isTls = parsed.protocol === 'rediss:';
  const host = parsed.hostname;
  const port = parseInt(parsed.port || (isTls ? '6379' : '6379'), 10);
  const password = parsed.password ? decodeURIComponent(parsed.password) : '';
  const username = parsed.username ? decodeURIComponent(parsed.username) : 'default';

  return {
    host,
    port,
    password,
    username,
    // BullMQ requires maxRetriesPerRequest: null for blocking commands
    maxRetriesPerRequest: null,
    // Required to avoid ioredis stalling before queue is ready
    enableReadyCheck: false,
    // Upstash always requires TLS
    tls: isTls ? ({} as ConnectionOptions) : undefined,
  };
}
