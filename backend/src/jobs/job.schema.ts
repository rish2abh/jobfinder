import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as crypto from 'crypto';

export type JobDocument = Job & Document;

export type JobSource = 'indeed' | 'naukri' | 'internshala' | 'jsearch' | 'google' | 'company';

@Schema({ timestamps: true })
export class Job {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  company: string;

  @Prop()
  location?: string;

  /** Full job description text */
  @Prop()
  jd?: string;

  /** Recruiter/contact email extracted from the JD when available */
  @Prop()
  contactEmail?: string;

  /** Direct link to apply */
  @Prop()
  applyUrl?: string;

  /** The URL that was scraped (may differ from applyUrl) */
  @Prop()
  scrapeUrl?: string;

  @Prop({
    enum: ['indeed', 'naukri', 'internshala', 'jsearch', 'google', 'company'],
    required: true,
  })
  source: JobSource;

  @Prop({ required: true })
  scrapedAt: Date;

  /** Raw posted-at string from the source (e.g. "2 days ago", "Jun 1") */
  @Prop()
  postedAt?: string;

  /**
   * Parsed ISO date derived from postedAt for accurate sorting.
   * Populated by the processor when postedAt can be parsed.
   */
  @Prop({ type: Date })
  postedAtDate?: Date;

  /**
   * SHA-256 hash of lowercase(title + '|' + company).
   * Used for deduplication — unique index.
   */
  @Prop({ required: true, unique: true })
  dedupeHash: string;

  /** Skills matched against the query that found this job */
  @Prop({ type: [String], default: [] })
  matchedSkills: string[];

  /**
   * If the job was found via a company-targeted search,
   * stores the company name that was targeted.
   */
  @Prop()
  targetCompany?: string;

  /**
   * Free-text keywords that were used in the search query.
   */
  @Prop({ type: [String], default: [] })
  queryKeywords: string[];

  @Prop({ default: false })
  flagged: boolean;

  @Prop()
  flagReason?: string;
}

export const JobSchema = SchemaFactory.createForClass(Job);

JobSchema.index({ source: 1, scrapedAt: -1 });
JobSchema.index({ matchedSkills: 1, scrapedAt: -1 });
JobSchema.index({ matchedSkills: 1, postedAtDate: -1 });
JobSchema.index({ targetCompany: 1, scrapedAt: -1 });
JobSchema.index({ contactEmail: 1 });

export function buildDedupeHash(title: string, company: string): string {
  const raw = `${title.toLowerCase().trim()}|${company.toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Best-effort parse of relative/absolute posted date strings into a Date.
 * Returns undefined if the string cannot be interpreted.
 */
export function parsePostedAtDate(raw?: string): Date | undefined {
  if (!raw) return undefined;

  const s = raw.trim().toLowerCase();

  // "X days/hours/minutes/weeks ago"
  const agoMatch = s.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/);
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const ms =
      unit === 'minute' ? n * 60_000 :
      unit === 'hour'   ? n * 3_600_000 :
      unit === 'day'    ? n * 86_400_000 :
      unit === 'week'   ? n * 7 * 86_400_000 :
      /* month */         n * 30 * 86_400_000;
    return new Date(Date.now() - ms);
  }

  // "today" / "just posted" / "new"
  if (/^(today|just posted|new)$/.test(s)) return new Date();

  // "yesterday"
  if (s === 'yesterday') return new Date(Date.now() - 86_400_000);

  // Try native Date parse (handles ISO strings, "Jun 1", "June 1, 2024", etc.)
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}
