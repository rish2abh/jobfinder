import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { buildRedisConnection } from '../mail/bull-redis.config';
import { UsersModule } from '../users/users.module';
import { JobsModule } from '../jobs/jobs.module';
import { MatchingModule } from '../matching/matching.module';
import { AutoApplyModule } from '../auto-apply/auto-apply.module';
import { MailModule } from '../mail/mail.module';
import { BulkContactModule } from '../bulk-contact/bulk-contact.module';
import { LoggerModule } from '../logger/logger.module';
import { AGENT_RUN_QUEUE } from './agent.types';
import { MAIL_QUEUE } from '../mail/mail-job.types';
import { AgentJournal, AgentJournalSchema } from './journal/agent-journal.schema';
import { Draft, DraftSchema } from './drafts/draft.schema';
import { ProcessedThread, ProcessedThreadSchema } from './tools/processed-thread.schema';
import { AgentController } from './agent.controller';
import { DraftsController } from './drafts/drafts.controller';
import { AgentProcessor } from './agent.processor';
import { GeminiClientService } from './gemini-client.service';
import { AgentJournalRepository } from './journal/agent-journal.repository';
import { DraftRepository } from './drafts/draft.repository';
import { GuardrailService } from './guardrails/guardrail.service';
import { ToolRegistry } from './tools/tool-registry';
import { JobTools } from './tools/job-tools';
import { ApplyTools } from './tools/apply-tools';
import { ColdEmailDrafterService } from './tools/cold-email-drafter.service';
import { InboxReaderService } from './tools/inbox-reader.service';
import { ProcessedThreadRepository } from './tools/processed-thread.repository';
import { ReplyDrafterService } from './tools/reply-drafter.service';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    forwardRef(() => JobsModule),
    forwardRef(() => MatchingModule),
    forwardRef(() => AutoApplyModule),
    forwardRef(() => MailModule),
    forwardRef(() => BulkContactModule),
    LoggerModule,
    MongooseModule.forFeature([
      { name: AgentJournal.name, schema: AgentJournalSchema },
      { name: Draft.name, schema: DraftSchema },
      { name: ProcessedThread.name, schema: ProcessedThreadSchema },
    ]),
    BullModule.registerQueueAsync({
      name: AGENT_RUN_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 60 * 60 * 24, count: 50 },
          removeOnFail: { age: 60 * 60 * 24 * 3 },
        },
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
  ],
  controllers: [AgentController, DraftsController],
  providers: [
    AgentProcessor,
    GeminiClientService,
    ToolRegistry,
    JobTools,
    ApplyTools,
    AgentJournalRepository,
    DraftRepository,
    GuardrailService,
    ColdEmailDrafterService,
    InboxReaderService,
    ProcessedThreadRepository,
    ReplyDrafterService,
  ],
  exports: [AgentJournalRepository, DraftRepository],
})
export class AgentModule {}
