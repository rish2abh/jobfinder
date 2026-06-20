import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DraftDocument = Draft & Document;

export type DraftType = 'cold_outreach' | 'reply';

export type DraftStatus = 'pending' | 'edited' | 'approved' | 'rejected' | 'sent' | 'failed';

@Schema({ timestamps: true })
export class Draft {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, enum: ['cold_outreach', 'reply'] })
  type: DraftType;

  @Prop({
    required: true,
    enum: ['pending', 'edited', 'approved', 'rejected', 'sent', 'failed'],
    default: 'pending',
  })
  status: DraftStatus;

  @Prop({ required: true })
  recipient: string;

  @Prop({ required: true, maxlength: 200 })
  subject: string;

  @Prop({ required: true, maxlength: 2000 })
  body: string;

  @Prop()
  sourceThreadId?: string;

  @Prop({ required: true })
  createdByRunId: string;

  @Prop()
  failureReason?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const DraftSchema = SchemaFactory.createForClass(Draft);

DraftSchema.index({ userId: 1, status: 1 });
DraftSchema.index({ userId: 1, createdAt: -1 });
