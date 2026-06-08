import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { Application, ApplicationSchema } from './application.schema';
import { ApplicationRepository } from './application.repository';
import { AutoApplyService } from './auto-apply.service';
import { AutoApplyController } from './auto-apply.controller';
import { AutoApplyProcessor } from './auto-apply.processor';
import { AUTO_APPLY_QUEUE } from './auto-apply.types';
import { buildRedisConnection } from '../mail/bull-redis.config';
import { UsersModule } from '../users/users.module';
import { JobsModule } from '../jobs/jobs.module';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    LoggerModule,
    forwardRef(() => JobsModule),
    MongooseModule.forFeature([{ name: Application.name, schema: ApplicationSchema }]),

    BullModule.registerQueueAsync({
      name: AUTO_APPLY_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 60 * 60 * 24, count: 200 },
          removeOnFail: { age: 60 * 60 * 24 * 7 },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AutoApplyController],
  providers: [ApplicationRepository, AutoApplyService, AutoApplyProcessor],
  exports: [AutoApplyService, ApplicationRepository],
})
export class AutoApplyModule {}
