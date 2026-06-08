import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MatchScoreDocument = MatchScore & Document;

@Schema({ timestamps: true })
export class MatchScore {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: string;

  @Prop({ type: Types.ObjectId, ref: 'Job', required: true })
  jobId: string;

  /** Cosine similarity from ChromaDB vector search (0-1) */
  @Prop({ required: true, min: 0, max: 1 })
  cosineSimilarity: number;

  /** Ratio of matched skills to total resume skills (0-1) */
  @Prop({ required: true, min: 0, max: 1 })
  skillOverlap: number;

  /** Final composite score: round((0.7 * cosine + 0.3 * skillOverlap) * 100), clamped [0, 100] */
  @Prop({ required: true, min: 0, max: 100 })
  finalScore: number;

  /** True if score was computed via keyword-only fallback (ChromaDB unavailable) */
  @Prop({ default: false })
  degraded: boolean;

  /** Timestamp when this score was computed */
  @Prop({ required: true })
  computedAt: Date;
}

export const MatchScoreSchema = SchemaFactory.createForClass(MatchScore);

// Compound unique index: one score per user-job pair
MatchScoreSchema.index({ userId: 1, jobId: 1 }, { unique: true });

// Sort index: efficiently query a user's scores sorted by best match first
MatchScoreSchema.index({ userId: 1, finalScore: -1 });
