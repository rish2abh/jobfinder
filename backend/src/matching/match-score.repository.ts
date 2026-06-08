import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder } from 'mongoose';
import { MatchScore, MatchScoreDocument } from './match-score.schema';

export interface BulkScoreEntry {
  userId: string;
  jobId: string;
  cosineSimilarity: number;
  skillOverlap: number;
  finalScore: number;
  degraded: boolean;
  computedAt: Date;
}

@Injectable()
export class MatchScoreRepository {
  private readonly logger = new Logger(MatchScoreRepository.name);

  constructor(
    @InjectModel(MatchScore.name) private readonly model: Model<MatchScoreDocument>,
  ) {}

  /**
   * Find a single score for a specific user-job pair.
   */
  async findByUserAndJob(userId: string, jobId: string): Promise<MatchScoreDocument | null> {
    return this.model.findOne({ userId, jobId }).exec();
  }

  /**
   * Find all scores for a user with pagination and sorting.
   */
  async findByUser(
    userId: string,
    options: { skip?: number; limit?: number; sort?: Record<string, SortOrder> } = {},
  ): Promise<MatchScoreDocument[]> {
    const sort = options.sort ?? { finalScore: -1 };

    return this.model
      .find({ userId })
      .sort(sort)
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 50)
      .exec();
  }

  /**
   * Bulk upsert scores — insert or update many scores at once.
   * Uses the compound unique index on { userId, jobId } for upsert matching.
   */
  async bulkUpsert(scores: BulkScoreEntry[]): Promise<{ upserted: number; modified: number }> {
    if (scores.length === 0) return { upserted: 0, modified: 0 };

    const bulkOps = scores.map((score) => ({
      updateOne: {
        filter: { userId: score.userId, jobId: score.jobId },
        update: {
          $set: {
            cosineSimilarity: score.cosineSimilarity,
            skillOverlap: score.skillOverlap,
            finalScore: score.finalScore,
            degraded: score.degraded,
            computedAt: score.computedAt,
          },
          $setOnInsert: {
            userId: score.userId,
            jobId: score.jobId,
          },
        },
        upsert: true,
      },
    }));

    try {
      const result = await this.model.bulkWrite(bulkOps, { ordered: false });
      return {
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
      };
    } catch (err: any) {
      this.logger.error(`bulkUpsert failed: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  /**
   * Invalidate (delete) all cached scores for a user.
   * Called when the user's profile is updated and scores need recomputation.
   */
  async invalidateByUser(userId: string): Promise<number> {
    const result = await this.model.deleteMany({ userId }).exec();
    return result.deletedCount;
  }

  /**
   * Invalidate (delete) specific scores for a user and a set of job IDs.
   * Called when new jobs are scraped and existing scores for those jobs are stale.
   */
  async invalidateByUserAndJobs(userId: string, jobIds: string[]): Promise<number> {
    if (jobIds.length === 0) return 0;

    const result = await this.model
      .deleteMany({ userId, jobId: { $in: jobIds } })
      .exec();
    return result.deletedCount;
  }

  /**
   * Count total scores for a user.
   */
  async countByUser(userId: string): Promise<number> {
    return this.model.countDocuments({ userId }).exec();
  }
}
