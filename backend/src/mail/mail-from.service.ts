import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailFrom, MailFromDocument } from './mail-from.schema';

@Injectable()
export class MailFromService {
  constructor(@InjectModel(MailFrom.name) private model: Model<MailFromDocument>) {}

  async createOrUpdate(address: string, ttlSeconds = 7 * 24 * 3600, status: 'active' | 'paused' | 'banned' = 'active') {
    const expireAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : undefined;

    const updated = await this.model.findOneAndUpdate(
      { address },
      { address, status, ttlSeconds, expireAt },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return updated;
  }

  async findActive() {
    return this.model.findOne({ status: 'active' }).sort({ createdAt: 1 }).exec();
  }

  async listAll() {
    return this.model.find().sort({ createdAt: -1 }).exec();
  }
}
