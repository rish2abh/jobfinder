import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MailFromDocument = MailFrom & Document;

@Schema({ timestamps: true })
export class MailFrom {
  @Prop({ required: true, unique: true })
  address: string;

  @Prop({ default: 'active' })
  status: 'active' | 'paused' | 'banned';

  @Prop({ type: Number, default: 0 })
  ttlSeconds: number;

  @Prop()
  expireAt?: Date;
}

export const MailFromSchema = SchemaFactory.createForClass(MailFrom);

// TTL index on expireAt — documents expire when expireAt is reached
MailFromSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
