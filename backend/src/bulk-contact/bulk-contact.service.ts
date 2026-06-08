import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { BulkContact, BulkContactDocument } from './bulk-contact.schema';
import { ContactGroup, ContactGroupDocument } from './contact-group.schema';
import { EmailTemplate, EmailTemplateDocument } from './email-template.schema';
import { ContactParserService, ParseResult } from './contact-parser.service';
import { GroupingService } from './grouping.service';
import { TemplateGeneratorService } from './template-generator.service';
import { PersonalizationService } from './personalization.service';
import { UsersService } from '../users/users.service';
import {
  MAIL_QUEUE,
  TEMPLATE_MAIL_JOB,
  TemplateMailJobData,
} from '../mail/mail-job.types';

@Injectable()
export class BulkContactService {
  private readonly logger = new Logger(BulkContactService.name);

  constructor(
    @InjectModel(BulkContact.name)
    private bulkContactModel: Model<BulkContactDocument>,
    @InjectModel(ContactGroup.name)
    private contactGroupModel: Model<ContactGroupDocument>,
    @InjectModel(EmailTemplate.name)
    private emailTemplateModel: Model<EmailTemplateDocument>,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
    private readonly contactParser: ContactParserService,
    private readonly groupingService: GroupingService,
    private readonly templateGenerator: TemplateGeneratorService,
    private readonly personalizationService: PersonalizationService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Upload, parse, and store contacts from a file.
   * Returns the parse result with stored contact count and validation report.
   */
  async uploadAndParse(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{
    totalParsed: number;
    storedCount: number;
    skippedCount: number;
    duplicateCount: number;
    skipped: { row: number; reason: string }[];
  }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    const userObjectId = new Types.ObjectId(userId);

    // Parse the file
    const parseResult: ParseResult = await this.contactParser.parse(
      file.buffer,
      file.mimetype,
      file.originalname,
    );

    this.logger.log(
      `Parsed ${parseResult.contacts.length} contacts from file "${file.originalname}" for user ${userId}`,
    );

    // Store contacts — deduplicate by email per user using bulkWrite for performance
    let storedCount = 0;
    let duplicateCount = 0;

    const bulkOps = parseResult.contacts.map((contact) => ({
      updateOne: {
        filter: { userId: userObjectId, email: contact.email.toLowerCase() },
        update: {
          $set: {
            userId: userObjectId,
            name: contact.name,
            email: contact.email.toLowerCase(),
            title: contact.title || undefined,
            company: contact.company || undefined,
            sourceFile: file.originalname,
            uploadedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      try {
        const bulkResult = await this.bulkContactModel.bulkWrite(bulkOps, {
          ordered: false,
        });
        storedCount =
          (bulkResult.upsertedCount ?? 0) + (bulkResult.modifiedCount ?? 0);
        // If modified, those were duplicates updated in place
        duplicateCount = bulkResult.modifiedCount ?? 0;
      } catch (error: any) {
        // bulkWrite with ordered:false still throws on some errors but processes all ops
        if (error.result) {
          storedCount =
            (error.result.nUpserted ?? 0) + (error.result.nModified ?? 0);
          duplicateCount = error.result.nModified ?? 0;
        } else {
          this.logger.warn(`Bulk write failed: ${error.message}`);
          // Fallback to individual inserts
          for (const contact of parseResult.contacts) {
            try {
              await this.bulkContactModel.findOneAndUpdate(
                { userId: userObjectId, email: contact.email.toLowerCase() },
                {
                  userId: userObjectId,
                  name: contact.name,
                  email: contact.email.toLowerCase(),
                  title: contact.title || undefined,
                  company: contact.company || undefined,
                  sourceFile: file.originalname,
                  uploadedAt: new Date(),
                },
                { upsert: true, new: true, setDefaultsOnInsert: true },
              );
              storedCount++;
            } catch (innerErr: any) {
              if (innerErr.code === 11000) {
                duplicateCount++;
              }
            }
          }
        }
      }
    }

    return {
      totalParsed: parseResult.contacts.length,
      storedCount,
      skippedCount: parseResult.skipped.length,
      duplicateCount,
      skipped: parseResult.skipped,
    };
  }

  /**
   * Group contacts by title or company for a user.
   */
  async groupContacts(
    userId: string,
    groupBy: 'title' | 'company',
  ): Promise<ContactGroupDocument[]> {
    const userObjectId = new Types.ObjectId(userId);

    // Fetch all contacts for the user
    const contacts = await this.bulkContactModel.find({ userId: userObjectId });

    if (contacts.length === 0) {
      throw new BadRequestException(
        'No contacts found for this user. Upload contacts first.',
      );
    }

    // Group using the grouping service
    const groups =
      groupBy === 'title'
        ? await this.groupingService.groupByTitle(userObjectId, contacts)
        : await this.groupingService.groupByCompany(userObjectId, contacts);

    this.logger.log(
      `Created ${groups.length} groups (by ${groupBy}) for user ${userId}`,
    );

    return groups;
  }

  /**
   * Get all contacts for a user.
   */
  async getContacts(userId: string): Promise<BulkContactDocument[]> {
    const userObjectId = new Types.ObjectId(userId);
    return this.bulkContactModel.find({ userId: userObjectId }).sort({ uploadedAt: -1 });
  }

  /**
   * Get all contact groups for a user.
   */
  async getGroups(userId: string): Promise<ContactGroupDocument[]> {
    const userObjectId = new Types.ObjectId(userId);
    return this.contactGroupModel.find({ userId: userObjectId });
  }

  /**
   * Generate AI templates for specified groups.
   */
  async generateTemplates(
    userId: string,
    groupIds: string[],
    userPrompt?: string,
  ): Promise<EmailTemplateDocument[]> {
    const userObjectId = new Types.ObjectId(userId);
    const templates: EmailTemplateDocument[] = [];

    // Fetch user profile to pass to AI for personalized template generation
    const user = await this.usersService.findById(userId);
    const profile = user?.profile || {};
    const userProfile: Record<string, unknown> = {
      name: user?.name || undefined,
      headline: profile.headline || undefined,
      bio: profile.bio || undefined,
      skills: profile.skills || [],
      location: profile.location || undefined,
    };

    for (const groupId of groupIds) {
      const groupObjectId = new Types.ObjectId(groupId);

      // Fetch the group
      const group = await this.contactGroupModel.findById(groupObjectId);
      if (!group) {
        this.logger.warn(
          `Group ${groupId} not found, skipping template generation`,
        );
        continue;
      }

      if (group.userId.toString() !== userId) {
        this.logger.warn(
          `Group ${groupId} does not belong to user ${userId}, skipping`,
        );
        continue;
      }

      // Generate template (uses cache internally)
      const template = await this.templateGenerator.generateTemplate(
        groupObjectId,
        userObjectId,
        group.groupType,
        group.groupValue,
        userProfile,
        userPrompt,
      );

      // Link template to group
      await this.contactGroupModel.findByIdAndUpdate(groupObjectId, {
        templateId: template._id,
      });

      templates.push(template);
    }

    this.logger.log(
      `Generated ${templates.length} templates for user ${userId}`,
    );

    return templates;
  }

  /**
   * Get all email templates for a user.
   */
  async getTemplates(userId: string): Promise<EmailTemplateDocument[]> {
    const userObjectId = new Types.ObjectId(userId);
    return this.emailTemplateModel.find({ userId: userObjectId }).sort({ cachedAt: -1 });
  }

  /**
   * Edit a template for a specific group.
   */
  async editTemplate(
    userId: string,
    groupId: string,
    subject: string,
    body: string,
  ): Promise<EmailTemplateDocument> {
    const groupObjectId = new Types.ObjectId(groupId);
    const userObjectId = new Types.ObjectId(userId);

    // Verify group belongs to user
    const group = await this.contactGroupModel.findById(groupObjectId);
    if (!group) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }
    if (group.userId.toString() !== userId) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }

    // Save/update template
    const template = await this.templateGenerator.saveManualTemplate(
      groupObjectId,
      userObjectId,
      subject,
      body,
    );

    // Link template to group
    await this.contactGroupModel.findByIdAndUpdate(groupObjectId, {
      templateId: template._id,
    });

    return template;
  }

  /**
   * Trigger bulk send for specified groups.
   * Enqueues one job per recipient with rate limiting handled at queue level (5/min).
   */
  async triggerSend(
    userId: string,
    groupIds: string[],
    from?: string,
    resumeUrl?: string,
  ): Promise<{ bulkJobId: string; totalRecipients: number; status: string }> {
    const bulkJobId = new Types.ObjectId().toHexString();
    let totalRecipients = 0;

    for (const groupId of groupIds) {
      const groupObjectId = new Types.ObjectId(groupId);

      // Fetch group
      const group = await this.contactGroupModel.findById(groupObjectId);
      if (!group || group.userId.toString() !== userId) {
        this.logger.warn(
          `Group ${groupId} not found or unauthorized, skipping`,
        );
        continue;
      }

      // Fetch template for the group
      const template = await this.emailTemplateModel.findOne({
        groupId: groupObjectId,
      });
      if (!template || (!template.subject && !template.body)) {
        this.logger.warn(
          `No template found for group ${groupId}, skipping send`,
        );
        continue;
      }

      // Fetch contacts for the group
      const contacts = await this.bulkContactModel.find({
        _id: { $in: group.contactIds },
      });

      if (contacts.length === 0) {
        this.logger.warn(`Group ${groupId} has no contacts, skipping`);
        continue;
      }

      // Deduplicate by email
      const seenEmails = new Set<string>();

      for (const contact of contacts) {
        const email = contact.email.toLowerCase();
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);

        // Personalize template for this recipient
        const personalized = this.personalizationService.personalizeTemplate(
          { subject: template.subject, body: template.body },
          {
            name: contact.name,
            company: contact.company,
            title: contact.title,
          },
        );

        // Enqueue one job per recipient
        const jobData: TemplateMailJobData = {
          userId,
          bulkJobId,
          groupId,
          recipientEmail: email,
          recipientName: contact.name,
          subject: personalized.subject,
          body: personalized.body,
          from,
          resumeUrl,
        };

        await this.mailQueue.add(TEMPLATE_MAIL_JOB, jobData, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: {
            age: 60 * 60 * 24,
            count: 1000,
          },
          removeOnFail: {
            age: 60 * 60 * 24 * 7,
          },
          // Per-user throttling: stagger jobs with a 12s delay between each recipient.
          // This ensures ~5 emails/minute per bulk send without blocking other users.
          delay: totalRecipients * 12_000,
        });

        totalRecipients++;
      }
    }

    this.logger.log(
      `Enqueued ${totalRecipients} template mail jobs (bulkJobId: ${bulkJobId}) for user ${userId}`,
    );

    return {
      bulkJobId,
      totalRecipients,
      status: totalRecipients > 0 ? 'queued' : 'no_recipients',
    };
  }

  /**
   * Get send status for a bulk job by scanning the mail queue.
   */
  async getSendStatus(bulkJobId: string): Promise<{
    bulkJobId: string;
    total: number;
    completed: number;
    failed: number;
    active: number;
    waiting: number;
  }> {
    // Fetch jobs from all states
    const [completed, failed, active, waiting, delayed] = await Promise.all([
      this.mailQueue.getCompleted(0, 500),
      this.mailQueue.getFailed(0, 500),
      this.mailQueue.getActive(0, 100),
      this.mailQueue.getWaiting(0, 500),
      this.mailQueue.getDelayed(0, 500),
    ]);

    const allJobs = [
      ...completed,
      ...failed,
      ...active,
      ...waiting,
      ...delayed,
    ];

    // Filter by bulkJobId
    const relevantJobs = allJobs.filter(
      (job) => job.data?.bulkJobId === bulkJobId,
    );

    const completedCount = relevantJobs.filter((j) =>
      completed.some((c) => c.id === j.id),
    ).length;
    const failedCount = relevantJobs.filter((j) =>
      failed.some((f) => f.id === j.id),
    ).length;
    const activeCount = relevantJobs.filter((j) =>
      active.some((a) => a.id === j.id),
    ).length;
    const waitingCount = relevantJobs.filter((j) =>
      [...waiting, ...delayed].some((w) => w.id === j.id),
    ).length;

    return {
      bulkJobId,
      total: relevantJobs.length,
      completed: completedCount,
      failed: failedCount,
      active: activeCount,
      waiting: waitingCount,
    };
  }
}
