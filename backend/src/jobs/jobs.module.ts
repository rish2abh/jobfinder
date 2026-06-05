import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { buildRedisConnection } from '../mail/bull-redis.config';
import { Job, JobSchema } from './job.schema';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { JobScrapeProcessor } from './job-scrape.processor';
import { JOB_SCRAPE_QUEUE } from './job-scrape.types';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
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
  ],
  controllers: [JobsController],
  providers: [JobsRepository, JobsService, JobScrapeProcessor],
  exports: [JobsService],
})
export class JobsModule {}
