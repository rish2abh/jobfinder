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
  password?: string;
  username?: string;
  tls?: ConnectionOptions;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
} {
  const useLocal = configService.get<string>('REDIS_LOCAL') === 'true';

  if (useLocal) {
    return {
      host: 'localhost',
      port: configService.get<number>('REDIS_PORT') || 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  const url =
    configService.get<string>('UPSTASH_REDIS_URL') ||
    configService.get<string>('REDIS_URL');

  if (!url) {
    throw new Error('UPSTASH_REDIS_URL or REDIS_URL is not set');
  }

  const parsed = new URL(url);
  const isTls = parsed.protocol === 'rediss:';

  const connection: any = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };

  if (isTls) {
    connection.tls = {} as ConnectionOptions;
  }

  return connection;
}
