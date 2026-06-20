import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Draft, DraftDocument } from './draft.schema';

@Injectable()
export class DraftRepository {
  constructor(
    @InjectModel(Draft.name)
    private readonly model: Model<DraftDocument>,
  ) {}

  async create(data: Partial<Draft>): Promise<DraftDocument> {
    return this.model.create(data);
  }

  async findById(draftId: string): Promise<DraftDocument | null> {
    return this.model.findById(draftId).exec();
  }

  async findPending(userId: string): Promise<DraftDocument[]> {
    return this.model
      .find({ userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    draftId: string,
    data: Partial<Draft>,
  ): Promise<DraftDocument | null> {
    return this.model
      .findByIdAndUpdate(draftId, { $set: data }, { new: true })
      .exec();
  }
}
