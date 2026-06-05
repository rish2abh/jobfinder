import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { FileUploadController } from './file-upload.controller';
import { FileUploadService } from './file-upload.service';
import { ResumeParseProcessor } from './resume-parse.processor';
import { buildRedisConnection } from '../mail/bull-redis.config';
import { RESUME_QUEUE } from './resume-job.types';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    LoggerModule,

    BullModule.registerQueueAsync({
      name: RESUME_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'fixed', delay: 3000 },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [FileUploadController],
  providers: [FileUploadService, ResumeParseProcessor],
})
export class FileUploadModule {}
