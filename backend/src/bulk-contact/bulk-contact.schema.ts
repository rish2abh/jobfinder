import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BulkContactDocument = BulkContact & Document;

@Schema({ timestamps: false })
export class BulkContact {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop()
  title?: string;

  @Prop()
  company?: string;

  @Prop({ required: true })
  sourceFile: string;

  @Prop({ required: true, default: () => new Date() })
  uploadedAt: Date;
}

export const BulkContactSchema = SchemaFactory.createForClass(BulkContact);

BulkContactSchema.index({ userId: 1, email: 1 }, { unique: true });
