import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EmailTemplateDocument = EmailTemplate & Document;

@Schema({ timestamps: false })
export class EmailTemplate {
  @Prop({ type: Types.ObjectId, ref: 'ContactGroup', required: true })
  groupId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, maxlength: 200 })
  subject: string;

  @Prop({ required: true, maxlength: 2000 })
  body: string;

  @Prop({ required: true, enum: ['ai', 'manual'] })
  generatedBy: 'ai' | 'manual';

  @Prop({ enum: ['groq', 'ollama'], default: null })
  aiProvider: 'groq' | 'ollama' | null;

  @Prop({ required: true, default: () => new Date() })
  cachedAt: Date;
}

export const EmailTemplateSchema = SchemaFactory.createForClass(EmailTemplate);

EmailTemplateSchema.index({ groupId: 1 }, { unique: true });
