import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';
import { MailFromService } from './mail-from.service';
import { MailFrom, MailFromSchema } from './mail-from.schema';
import { buildRedisConnection } from './bull-redis.config';
import { MAIL_QUEUE } from './mail-job.types';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    MongooseModule.forFeature([{ name: MailFrom.name, schema: MailFromSchema }]),

    /**
     * Register the BullMQ queue using the Upstash Redis connection.
     * The connection is built from UPSTASH_REDIS_URL at startup.
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
