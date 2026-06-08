import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { MatchingModule } from '../matching/matching.module';
import { LoggerModule } from '../logger/logger.module';
import { buildRedisConnection } from '../mail/bull-redis.config';
import { Job, JobSchema } from './job.schema';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { JobMonitorController } from './job-monitor.controller';
import { JobScrapeProcessor } from './job-scrape.processor';
import { JOB_SCRAPE_QUEUE } from './job-scrape.types';
import { RESUME_QUEUE } from '../file-upload/resume-job.types';
import { MAIL_QUEUE } from '../mail/mail-job.types';
import { MATCHING_QUEUE } from '../matching/matching.types';
import { AUTO_APPLY_QUEUE } from '../auto-apply/auto-apply.types';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    LoggerModule,
    forwardRef(() => MatchingModule),
    MongooseModule.forFeature([{ name: Job.name, schema: JobSchema }]),

    BullModule.registerQueueAsync({
      name: JOB_SCRAPE_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'fixed', delay: 5000 },
        },
      }),
      inject: [ConfigService],
    }),

    // Register remaining queues for the job monitor controller
    BullModule.registerQueueAsync({
      name: RESUME_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: MATCHING_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: AUTO_APPLY_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [JobsController, JobMonitorController],
  providers: [JobsRepository, JobsService, JobScrapeProcessor],
  exports: [JobsService, JobsRepository],
})
export class JobsModule {}
