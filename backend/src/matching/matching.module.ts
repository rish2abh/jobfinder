import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { MatchScore, MatchScoreSchema } from './match-score.schema';
import { MatchScoreRepository } from './match-score.repository';
import { EmbeddingService } from './embedding.service';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';
import { MatchingProcessor } from './matching.processor';
import { MATCHING_QUEUE } from './matching.types';
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
    MongooseModule.forFeature([{ name: MatchScore.name, schema: MatchScoreSchema }]),

    BullModule.registerQueueAsync({
      name: MATCHING_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MatchingController],
  providers: [MatchScoreRepository, EmbeddingService, MatchingService, MatchingProcessor],
  exports: [MatchingService, EmbeddingService, MatchScoreRepository],
})
export class MatchingModule {}
