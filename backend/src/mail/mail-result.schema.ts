import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MailResultDocument = MailResult & Document;

@Schema({ timestamps: false })
export class MailResult {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  bulkJobId: string;

  @Prop({ type: Types.ObjectId, ref: 'ContactGroup', required: true })
  groupId: Types.ObjectId;

  @Prop({ required: true })
  recipientEmail: string;

  @Prop({ required: true })
  recipientName: string;

  @Prop({ required: true, enum: ['sent', 'failed'] })
  status: 'sent' | 'failed';

  @Prop()
  failureReason?: string;

  @Prop()
  sentAt?: Date;
}

export const MailResultSchema = SchemaFactory.createForClass(MailResult);

MailResultSchema.index({ userId: 1, bulkJobId: 1 });
MailResultSchema.index({ userId: 1, sentAt: -1 });
