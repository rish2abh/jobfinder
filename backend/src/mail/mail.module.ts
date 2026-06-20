import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { LoggerModule } from '../logger/logger.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { MailFromService } from './mail-from.service';
import { MailFrom, MailFromSchema } from './mail-from.schema';
import { MailResult, MailResultSchema } from './mail-result.schema';
import { Draft, DraftSchema } from '../agent/drafts/draft.schema';
import { buildRedisConnection } from './bull-redis.config';
import { MAIL_QUEUE } from './mail-job.types';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    LoggerModule,
    MongooseModule.forFeature([
      { name: MailFrom.name, schema: MailFromSchema },
      { name: MailResult.name, schema: MailResultSchema },
      { name: Draft.name, schema: DraftSchema },
    ]),

    /**
     * Register the BullMQ queue using the Upstash Redis connection.
     * The connection is built from UPSTASH_REDIS_URL at startup.
     *
     * Rate limiter: 5 emails per minute (60000ms).
     * NOTE: This is a global queue-level limiter. Per-user rate limiting
     * is enforced at the service layer via job grouping (BullMQ group key).
     */
    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MailController],
  providers: [MailService, MailProcessor, MailFromService],
  exports: [MailFromService, MailService],
})
export class MailModule {}
