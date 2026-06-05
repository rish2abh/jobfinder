import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export class ExperienceItemDto {
  @ApiPropertyOptional({ example: 'Google' })
  @IsOptional() @IsString()
  company?: string;

  @ApiPropertyOptional({ example: 'Software Engineer' })
  @IsOptional() @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Jan 2021' })
  @IsOptional() @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: 'Present' })
  @IsOptional() @IsString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'Built scalable backend services' })
  @IsOptional() @IsString()
  description?: string;
}

export class EducationItemDto {
  @ApiPropertyOptional({ example: 'IIT Delhi' })
  @IsOptional() @IsString()
  institution?: string;

  @ApiPropertyOptional({ example: 'B.Tech' })
  @IsOptional() @IsString()
  degree?: string;

  @ApiPropertyOptional({ example: 'Computer Science' })
  @IsOptional() @IsString()
  field?: string;

  @ApiPropertyOptional({ example: '2017' })
  @IsOptional() @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2021' })
  @IsOptional() @IsString()
  endDate?: string;
}

export class ProjectItemDto {
  @ApiPropertyOptional({ example: 'JobFinder' })
  @IsOptional() @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'AI-powered job matching platform' })
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ example: ['Node.js', 'React'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  technologies?: string[];
}

export class UpdateProfileDto {
  /* ── Identity ─────────────────────────────────────────────── */
  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsOptional() @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'rahul@example.com' })
  @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional() @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Bengaluru, India' })
  @IsOptional() @IsString()
  location?: string;

  /* ── Professional headline & bio ──────────────────────────── */
  @ApiPropertyOptional({ example: 'Full-Stack Developer · 4 YOE · Open to Remote' })
  @IsOptional() @IsString()
  headline?: string;

  @ApiPropertyOptional({ example: 'Passionate developer who loves building products...' })
  @IsOptional() @IsString()
  bio?: string;

  /* ── Online presence ─────────────────────────────────────── */
  @ApiPropertyOptional({ example: 'https://linkedin.com/in/rahulsharma' })
  @IsOptional() @IsString()
  linkedin?: string;

  @ApiPropertyOptional({ example: 'https://github.com/rahulsharma' })
  @IsOptional() @IsString()
  github?: string;

  @ApiPropertyOptional({ example: 'https://rahulsharma.dev' })
  @IsOptional() @IsString()
  website?: string;

  /* ── Skills ──────────────────────────────────────────────── */
  @ApiPropertyOptional({ example: ['Node.js', 'React', 'MongoDB'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  skills?: string[];

  /* ── Structured sections ─────────────────────────────────── */
  @ApiPropertyOptional({ type: [ExperienceItemDto] })
  @IsOptional() @IsArray()
  @ValidateNested({ each: true }) @Type(() => ExperienceItemDto)
  experience?: ExperienceItemDto[];

  @ApiPropertyOptional({ type: [EducationItemDto] })
  @IsOptional() @IsArray()
  @ValidateNested({ each: true }) @Type(() => EducationItemDto)
  education?: EducationItemDto[];

  @ApiPropertyOptional({ example: ['AWS Certified Developer'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  certifications?: string[];

  @ApiPropertyOptional({ example: ['English', 'Hindi'] })
  @IsOptional() @IsArray() @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ type: [ProjectItemDto] })
  @IsOptional() @IsArray()
  @ValidateNested({ each: true }) @Type(() => ProjectItemDto)
  projects?: ProjectItemDto[];
}
