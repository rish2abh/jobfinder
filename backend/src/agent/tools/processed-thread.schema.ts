import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProcessedThreadDocument = ProcessedThread & Document;

@Schema({ timestamps: false, collection: 'processed_threads' })
export class ProcessedThread {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  threadId: string;

  @Prop({ required: true, default: () => new Date() })
  processedAt: Date;
}

export const ProcessedThreadSchema = SchemaFactory.createForClass(ProcessedThread);

ProcessedThreadSchema.index({ userId: 1, threadId: 1 }, { unique: true });
