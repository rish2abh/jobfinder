import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentJournal, AgentJournalDocument } from './agent-journal.schema';

@Injectable()
export class AgentJournalRepository {
  constructor(
    @InjectModel(AgentJournal.name)
    private readonly journalModel: Model<AgentJournalDocument>,
  ) {}

  async create(data: Partial<AgentJournal>): Promise<AgentJournalDocument> {
    return this.journalModel.create(data);
  }

  async findByUser(
    userId: string,
    options: { skip?: number; limit?: number } = {},
  ): Promise<{ entries: AgentJournalDocument[]; total: number }> {
    const skip = options.skip ?? 0;
    const limit = options.limit ?? 50;

    const [entries, total] = await Promise.all([
      this.journalModel
        .find({ userId })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.journalModel.countDocuments({ userId }),
    ]);

    return { entries: entries as AgentJournalDocument[], total };
  }

  async findByConversation(
    userId: string,
    conversationId: string,
  ): Promise<AgentJournalDocument[]> {
    return this.journalModel
      .find({ userId, conversationId })
      .sort({ timestamp: 1 })
      .lean()
      .exec() as Promise<AgentJournalDocument[]>;
  }

  async getRecentContext(
    userId: string,
    conversationId: string,
    limit = 5,
  ): Promise<AgentJournalDocument[]> {
    return this.journalModel
      .find({ userId, conversationId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()
      .exec() as Promise<AgentJournalDocument[]>;
  }
}
