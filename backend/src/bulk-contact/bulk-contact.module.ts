import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { buildRedisConnection } from '../mail/bull-redis.config';
import { MAIL_QUEUE } from '../mail/mail-job.types';
import { BulkContact, BulkContactSchema } from './bulk-contact.schema';
import { ContactGroup, ContactGroupSchema } from './contact-group.schema';
import { EmailTemplate, EmailTemplateSchema } from './email-template.schema';
import { ContactParserService } from './contact-parser.service';
import { GroupingService } from './grouping.service';
import { TemplateGeneratorService } from './template-generator.service';
import { PersonalizationService } from './personalization.service';
import { BulkContactService } from './bulk-contact.service';
import { BulkContactController } from './bulk-contact.controller';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    MailModule,

    MongooseModule.forFeature([
      { name: BulkContact.name, schema: BulkContactSchema },
      { name: ContactGroup.name, schema: ContactGroupSchema },
      { name: EmailTemplate.name, schema: EmailTemplateSchema },
    ]),

    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [BulkContactController],
  providers: [
    ContactParserService,
    GroupingService,
    TemplateGeneratorService,
    PersonalizationService,
    BulkContactService,
  ],
  exports: [BulkContactService],
})
export class BulkContactModule {}
