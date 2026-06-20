import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Application, ApplicationDocument, ApplicationStatus } from './application.schema';

@Injectable()
export class ApplicationRepository {
  private readonly logger = new Logger(ApplicationRepository.name);

  constructor(
    @InjectModel(Application.name)
    private readonly model: Model<ApplicationDocument>,
  ) {}

  async create(data: {
    userId: string;
    jobId: string;
    platform: string;
    status?: ApplicationStatus;
  }): Promise<ApplicationDocument> {
    return this.model.create({
      userId: data.userId,
      jobId: data.jobId,
      platform: data.platform,
      status: data.status ?? 'pending',
    });
  }

  async updateStatus(
    userId: string,
    jobId: string,
    update: {
      status: ApplicationStatus;
      appliedAt?: Date;
      failureReason?: string;
      skippedFields?: Array<{ fieldIdentifier: string; reason: string }>;
    },
  ): Promise<ApplicationDocument | null> {
    return this.model
      .findOneAndUpdate(
        { userId, jobId },
        { $set: update },
        { new: true },
      )
      .exec();
  }

  async findByUser(
    userId: string,
    options: { status?: ApplicationStatus; skip?: number; limit?: number } = {},
  ): Promise<ApplicationDocument[]> {
    const filter: any = { userId };
    if (options.status) filter.status = options.status;

    return this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 50)
      .exec();
  }

  async findByUserAndJob(userId: string, jobId: string): Promise<ApplicationDocument | null> {
    return this.model.findOne({ userId, jobId }).exec();
  }

  async countByUser(userId: string, status?: ApplicationStatus): Promise<number> {
    const filter: any = { userId };
    if (status) filter.status = status;
    return this.model.countDocuments(filter).exec();
  }

  /**
   * Count applications created by a user since a given date.
   * Used by the agent's daily cap guardrail to enforce limits.
   */
  async countByUserSince(userId: string, since: Date): Promise<number> {
    return this.model
      .countDocuments({ userId, createdAt: { $gte: since } })
      .exec();
  }

  async getStats(userId: string): Promise<Record<ApplicationStatus, number>> {
    const results = await this.model
      .aggregate([
        { $match: { userId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    const stats: Record<string, number> = {
      pending: 0,
      applied: 0,
      failed: 0,
      requires_manual_action: 0,
    };

    for (const row of results) {
      stats[row._id] = row.count;
    }

    return stats as Record<ApplicationStatus, number>;
  }
}
