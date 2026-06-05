import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder } from 'mongoose';
import { Job, JobDocument, JobSource, buildDedupeHash, parsePostedAtDate } from './job.schema';
import type { ScrapedRawJob } from './job-scrape.types';

@Injectable()
export class JobsRepository {
  private readonly logger = new Logger(JobsRepository.name);

  constructor(@InjectModel(Job.name) private readonly model: Model<JobDocument>) {}

  /**
   * Bulk-upsert scraped jobs.
   * Uses dedupeHash as the unique key — duplicate jobs are silently skipped.
   * Returns counts of inserted vs duplicate.
   */
  async bulkUpsert(
    rawJobs: ScrapedRawJob[],
    matchedSkillsMap: Map<string, string[]>,
    queryKeywords: string[] = [],
  ): Promise<{ inserted: number; duplicates: number }> {
    if (rawJobs.length === 0) return { inserted: 0, duplicates: 0 };

    let inserted = 0;
    let duplicates = 0;

    for (const raw of rawJobs) {
      const hash = buildDedupeHash(raw.title, raw.company);
      const matchedSkills = matchedSkillsMap.get(hash) ?? [];
      const postedAtDate = parsePostedAtDate(raw.postedAt);

      try {
        const result = await this.model.updateOne(
          { dedupeHash: hash },
          {
            $setOnInsert: {
              title:         raw.title,
              company:       raw.company,
              location:      raw.location,
              applyUrl:      raw.applyUrl,
              scrapeUrl:     raw.scrapeUrl,
              jd:            raw.jd,
              contactEmail:  raw.contactEmail,
              source:        raw.source,
              postedAt:      raw.postedAt,
              postedAtDate,
              dedupeHash:    hash,
              flagged:       raw.flagged ?? false,
              flagReason:    raw.flagReason,
              targetCompany: raw.targetCompany,
            },
            $set: {
              matchedSkills,
              queryKeywords,
              scrapedAt: new Date(),
              flagged: raw.flagged ?? false,
              flagReason: raw.flagReason ?? null,
              ...(raw.jd ? { jd: raw.jd } : {}),
              ...(raw.contactEmail ? { contactEmail: raw.contactEmail } : {}),
              ...(postedAtDate ? { postedAtDate } : {}),
            },
          },
          { upsert: true },
        );

        if (result.upsertedCount > 0) inserted++;
        else duplicates++;
      } catch (err: any) {
        // E11000 duplicate key — race condition on concurrent upserts, safe to skip
        if (err?.code === 11000) {
          duplicates++;
        } else {
          this.logger.warn(`bulkUpsert error for "${raw.title}" @ "${raw.company}": ${err?.message}`);
        }
      }
    }

    return { inserted, duplicates };
  }

  async findBySkills(
    skills: string[],
    options: {
      limit?: number;
      skip?: number;
      source?: JobSource;
      excludeFlagged?: boolean;
      experienceKeywords?: string[];
      sortBy?: 'postedAt' | 'scrapedAt';
    } = {},
  ): Promise<JobDocument[]> {
    const filter: FilterQuery<JobDocument> = {};
    const andClauses: FilterQuery<JobDocument>[] = [];

    if (skills.length > 0) {
      const skillVariants = this.expandSkillVariants(skills);
      const skillRegex    = skillVariants
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

      andClauses.push({
        $or: [
          { matchedSkills: { $in: skillVariants } },
          { title: { $regex: skillRegex, $options: 'i' } },
          { jd:    { $regex: skillRegex, $options: 'i' } },
        ],
      });
    }

    if (options.source) filter.source = options.source;
    if (options.excludeFlagged !== false) filter.flagged = { $ne: true };

    // Experience filter — title only
    if (options.experienceKeywords?.length) {
      const regex = options.experienceKeywords
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      andClauses.push({ title: { $regex: regex, $options: 'i' } });
    }

    if (andClauses.length > 0) filter.$and = andClauses;

    const sort: Record<string, SortOrder> =
      options.sortBy === 'postedAt'
        ? { postedAtDate: -1, scrapedAt: -1 }
        : { scrapedAt: -1 };

    const results = await this.model
      .find(filter)
      .sort(sort)
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 50)
      .exec();

    // Fallback: if skill filter returned nothing, show all non-flagged jobs
    // (happens when all jobs have empty matchedSkills and titles don't mention the skill)
    if (results.length === 0 && skills.length > 0 && !options.source && !options.experienceKeywords?.length) {
      return this.model
        .find({ flagged: { $ne: true } })
        .sort(sort)
        .skip(options.skip ?? 0)
        .limit(options.limit ?? 50)
        .exec();
    }

    return results;
  }

  async countBySkills(
    skills: string[],
    options: {
      excludeFlagged?: boolean;
      source?: JobSource;
      experienceKeywords?: string[];
    } = {},
  ): Promise<number> {
    const filter: FilterQuery<JobDocument> = {};
    const andClauses: FilterQuery<JobDocument>[] = [];

    if (skills.length > 0) {
      const skillVariants = this.expandSkillVariants(skills);
      const skillRegex    = skillVariants
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      andClauses.push({
        $or: [
          { matchedSkills: { $in: skillVariants } },
          { title: { $regex: skillRegex, $options: 'i' } },
          { jd:    { $regex: skillRegex, $options: 'i' } },
        ],
      });
    }

    if (options.excludeFlagged !== false) filter.flagged = { $ne: true };
    if (options.source) filter.source = options.source;

    if (options.experienceKeywords?.length) {
      const regex = options.experienceKeywords
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      andClauses.push({ title: { $regex: regex, $options: 'i' } });
    }

    if (andClauses.length > 0) filter.$and = andClauses;

    const count = await this.model.countDocuments(filter).exec();

    // Same fallback: if skill-filtered count is 0, count all non-flagged
    if (count === 0 && skills.length > 0 && !options.source && !options.experienceKeywords?.length) {
      return this.model.countDocuments({ flagged: { $ne: true } }).exec();
    }

    return count;
  }

  /**
   * Expands common skill aliases so "Node js", "Node.js", "nodejs" all match each other.
   */
  private expandSkillVariants(skills: string[]): string[] {
    const variants = new Set<string>();

    for (const skill of skills) {
      const lower = skill.toLowerCase().trim();
      variants.add(lower);

      // Node.js variants
      if (/^node\.?js$/i.test(lower) || lower === 'node js') {
        variants.add('node.js'); variants.add('nodejs'); variants.add('node js');
      }
      // React variants
      if (/^react\.?js$/i.test(lower) || lower === 'react') {
        variants.add('react'); variants.add('react.js'); variants.add('reactjs');
      }
      // Vue variants
      if (/^vue\.?js$/i.test(lower) || lower === 'vue') {
        variants.add('vue'); variants.add('vue.js'); variants.add('vuejs');
      }
      // Express variants
      if (/^express\.?js$/i.test(lower)) {
        variants.add('express'); variants.add('express.js'); variants.add('expressjs');
      }
      // Next variants
      if (/^next\.?js$/i.test(lower)) {
        variants.add('next'); variants.add('next.js'); variants.add('nextjs');
      }
      // TypeScript
      if (lower === 'typescript' || lower === 'ts') {
        variants.add('typescript'); variants.add('ts');
      }
      // JavaScript
      if (lower === 'javascript' || lower === 'js') {
        variants.add('javascript'); variants.add('js');
      }
      // Mongo
      if (lower.includes('mongo')) {
        variants.add('mongodb'); variants.add('mongo');
      }
      // Postgres
      if (lower.includes('postgres')) {
        variants.add('postgresql'); variants.add('postgres');
      }
      // Remove dots/spaces so "Node.js" also matches "NodeJS" in title regex
      const stripped = lower.replace(/[.\s-]/g, '');
      if (stripped !== lower) variants.add(stripped);
    }

    return [...variants];
  }

  /**
   * Check if a fresh scrape exists for the given skills.
   * Returns true only when there are >= MIN_FRESH_COUNT non-flagged jobs
   * that match the skills AND were scraped within the last 24h.
   *
   * The broad "any fresh job" fallback is intentionally removed — it was
   * blocking re-scrapes even when the existing results were unrelated.
   */
  async hasFreshResults(skills: string[]): Promise<boolean> {
    const MIN_FRESH_COUNT = 10; // only skip scrape if we have at least 10 relevant jobs
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (skills.length === 0) {
      const count = await this.model
        .countDocuments({ scrapedAt: { $gte: cutoff }, flagged: { $ne: true } })
        .exec();
      return count >= MIN_FRESH_COUNT;
    }

    const skillVariants = this.expandSkillVariants(skills);
    const skillRegex    = skillVariants
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    const matched = await this.model
      .countDocuments({
        scrapedAt: { $gte: cutoff },
        flagged: { $ne: true },
        $or: [
          { matchedSkills: { $in: skillVariants } },
          { title: { $regex: skillRegex, $options: 'i' } },
          { jd:    { $regex: skillRegex, $options: 'i' } },
        ],
      })
      .exec();

    return matched >= MIN_FRESH_COUNT;
  }

  async findById(id: string): Promise<JobDocument | null> {
    return this.model.findById(id).exec();
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }

  async deleteBySource(source: JobSource): Promise<number> {
    const result = await this.model.deleteMany({ source }).exec();
    return result.deletedCount;
  }

  async deleteAll(): Promise<number> {
    const result = await this.model.deleteMany({}).exec();
    return result.deletedCount;
  }

  async getCacheStats(): Promise<{
    total: number;
    bySource: Record<string, number>;
    flagged: number;
    fresh24h: number;
    oldest: Date | null;
    newest: Date | null;
  }> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, flagged, fresh24h, bySourceAgg, dateAgg] = await Promise.all([
      this.model.countDocuments({}).exec(),
      this.model.countDocuments({ flagged: true }).exec(),
      this.model.countDocuments({ scrapedAt: { $gte: cutoff } }).exec(),
      this.model.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]).exec(),
      this.model.aggregate([
        { $group: { _id: null, oldest: { $min: '$scrapedAt' }, newest: { $max: '$scrapedAt' } } },
      ]).exec(),
    ]);

    const bySource: Record<string, number> = {};
    for (const row of bySourceAgg) {
      bySource[row._id] = row.count;
    }

    return {
      total,
      bySource,
      flagged,
      fresh24h,
      oldest: dateAgg[0]?.oldest ?? null,
      newest: dateAgg[0]?.newest ?? null,
    };
  }

  async listAll(options: { limit?: number; skip?: number; source?: JobSource } = {}): Promise<JobDocument[]> {
    const filter: FilterQuery<JobDocument> = {};
    if (options.source) filter.source = options.source;
    return this.model
      .find(filter)
      .sort({ scrapedAt: -1 })
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 200)   // default 200 for cache browser
      .exec();
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.model.deleteMany({ scrapedAt: { $lt: cutoff } }).exec();
    return result.deletedCount;
  }

  /**
   * Clear captcha-related flags from all jobs.
   * Called once to fix jobs incorrectly flagged by the JD fetcher CAPTCHA bug.
   */
  async clearCaptchaFlags(): Promise<number> {
    const result = await this.model.updateMany(
      { flagReason: 'captcha_on_jd_fetch' },
      { $set: { flagged: false, flagReason: null } },
    ).exec();
    return result.modifiedCount;
  }
}
