import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ── Nested sub-schemas ──────────────────────────────────────────────────────

export interface ExperienceItem {
  company?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface EducationItem {
  institution?: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

export interface ProjectItem {
  name?: string;
  description?: string;
  technologies?: string[];
}

/**
 * Structured profile used for job applications.
 * Populated automatically from the Ollama-parsed resume JSON,
 * with a regex-based raw-text fallback, and always editable by the user.
 */
export interface UserProfile {
  // Identity
  phone?: string;
  location?: string;
  // Professional
  headline?: string;
  bio?: string;
  // Online presence
  linkedin?: string;
  github?: string;
  website?: string;
  // Content
  skills?: string[];
  experience?: ExperienceItem[];
  education?: EducationItem[];
  certifications?: string[];
  languages?: string[];
  projects?: ProjectItem[];
  // Meta
  lastUpdatedFrom?: 'resume_parse' | 'raw_text_extract' | 'manual';
  updatedAt?: Date;
}

// ── Main User schema ────────────────────────────────────────────────────────

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  // Raw resume data (set by the file-upload pipeline)
  @Prop({ type: Object, default: {} })
  resume: Record<string, any>;

  @Prop()
  resumeRawText?: string;

  @Prop()
  resumeCloudinaryUrl?: string;

  @Prop()
  resumeCloudinaryId?: string;

  @Prop({ type: [{ type: Object }], default: [] })
  resumeVersions?: Array<Record<string, any>>;

  /**
   * Structured job-application profile.
   * Separate from `resume` so edits here don't conflict with re-parses.
   */
  @Prop({ type: Object, default: {} })
  profile: UserProfile;
}

export const UserSchema = SchemaFactory.createForClass(User);
