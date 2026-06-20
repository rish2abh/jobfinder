import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProcessedThread, ProcessedThreadDocument } from './processed-thread.schema';

@Injectable()
export class ProcessedThreadRepository {
  constructor(
    @InjectModel(ProcessedThread.name)
    private readonly model: Model<ProcessedThreadDocument>,
  ) {}

  /**
   * Check which threadIds have already been processed for a given user.
   * Returns the set of already-processed IDs.
   */
  async findProcessed(userId: string, threadIds: string[]): Promise<Set<string>> {
    const docs = await this.model
      .find({ userId, threadId: { $in: threadIds } })
      .select('threadId')
      .lean()
      .exec();

    return new Set(docs.map((d) => d.threadId));
  }

  /**
   * Mark a thread as processed. Uses upsert to avoid duplicates.
   */
  async markProcessed(userId: string, threadId: string): Promise<void> {
    await this.model.updateOne(
      { userId, threadId },
      { $setOnInsert: { userId, threadId, processedAt: new Date() } },
      { upsert: true },
    ).exec();
  }
}
