import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { JobSource } from '../job.schema';

const VALID_SOURCES: JobSource[] = ['indeed', 'naukri', 'internshala', 'jsearch', 'google', 'company'];

const toArray = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

export class TriggerScrapeDto {
  @ApiPropertyOptional({
    description: 'Deprecated: userId is now derived from the JWT token. This field is ignored.',
    example: '665df8d2f98f48bd8f04f2a1',
  })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({
    description: "Skill keywords. If omitted, uses skills from the user's parsed resume.",
    example: ['React', 'Node.js', 'MongoDB'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  skills?: string[];

  @ApiPropertyOptional({
    description:
      'Target company names. Searches are focused on these companies: ' +
      '"React developer jobs at Google", "Node.js Microsoft" etc.',
    example: ['Google', 'Microsoft', 'Atlassian'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  companies?: string[];

  @ApiPropertyOptional({
    description:
      'Free-text keywords appended to every query, e.g. "remote", "senior", "full-time".',
    example: ['remote', 'senior'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(toArray)
  keywords?: string[];

  @ApiPropertyOptional({
    description: 'Sources to scrape. Defaults to all.',
    enum: VALID_SOURCES,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(VALID_SOURCES, { each: true })
  sources?: JobSource[];

  @ApiPropertyOptional({
    description: 'Max results to fetch per source. Default 30.',
    example: 30,
    minimum: 5,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(100)
  maxPerSource?: number;

  @ApiPropertyOptional({
    description: 'Force re-scrape even if fresh results exist in cache.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Country to search jobs in (e.g. "India", "United States", "Remote").',
    example: 'India',
  })
  @IsOptional()
  @IsString()
  country?: string;
}
