import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ApplicationDocument = Application & Document;

export type ApplicationStatus = 'pending' | 'applied' | 'failed' | 'requires_manual_action';

@Schema({ timestamps: true })
export class Application {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  jobId: string;

  @Prop({
    required: true,
    enum: ['pending', 'applied', 'failed', 'requires_manual_action'],
    default: 'pending',
  })
  status: ApplicationStatus;

  @Prop({ required: true })
  platform: string;

  @Prop()
  appliedAt?: Date;

  @Prop()
  failureReason?: string;

  @Prop({ type: [{ fieldIdentifier: String, reason: String }], default: [] })
  skippedFields: Array<{ fieldIdentifier: string; reason: string }>;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ApplicationSchema = SchemaFactory.createForClass(Application);

// Compound indexes for efficient queries
ApplicationSchema.index({ userId: 1, status: 1 });
ApplicationSchema.index({ userId: 1, createdAt: -1 });
ApplicationSchema.index({ userId: 1, jobId: 1 }, { unique: true });
