import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentJournalDocument = AgentJournal & Document;

@Schema({ timestamps: true, collection: 'agent_journal' })
export class AgentJournal {
  @Prop({ required: true, index: true })
  runId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  conversationId: string;

  /** What triggered this run: 'user_chat' | 'api' | 'scheduled' */
  @Prop({ required: true, default: 'user_chat' })
  trigger: string;

  @Prop({ required: true })
  userMessage: string;

  @Prop({ required: true })
  agentResponse: string;

  /** Short summary of what the agent did (tool names + outcome) */
  @Prop()
  summary: string;

  @Prop({ type: [Object], default: [] })
  actions: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs: number;
  }>;

  @Prop({ default: 0 })
  iterations: number;

  @Prop({ type: Object })
  tokenUsage: { prompt: number; completion: number; total: number };

  @Prop()
  durationMs: number;

  @Prop()
  error?: string;

  @Prop({ required: true })
  timestamp: Date;
}

export const AgentJournalSchema = SchemaFactory.createForClass(AgentJournal);

AgentJournalSchema.index({ userId: 1, timestamp: -1 });
AgentJournalSchema.index({ userId: 1, conversationId: 1, timestamp: 1 });
