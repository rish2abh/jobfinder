import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContactGroupDocument = ContactGroup & Document;

@Schema({ timestamps: false })
export class ContactGroup {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['title', 'company'] })
  groupType: 'title' | 'company';

  @Prop({ required: true })
  groupValue: string;

  @Prop({ type: [Types.ObjectId], ref: 'BulkContact', default: [] })
  contactIds: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'EmailTemplate' })
  templateId?: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const ContactGroupSchema = SchemaFactory.createForClass(ContactGroup);

ContactGroupSchema.index({ userId: 1, groupType: 1, groupValue: 1 });
