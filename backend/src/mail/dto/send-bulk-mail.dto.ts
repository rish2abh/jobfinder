import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const transformMailIds = ({ value }: { value: string[] | string }) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String) : [trimmed];
    } catch {
      return [trimmed];
    }
  }

  return trimmed.split(',').map((mailId) => mailId.trim());
};

export class SendBulkMailDto {
  @ApiProperty({ example: 'Application for Software Developer Role' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ example: 'Hello, please find my resume attached for your consideration.' })
  @IsString()
  @IsNotEmpty()
  context: string;

  @ApiProperty({
    description: 'Multiple recipient email ids. In multipart/form-data, send as comma-separated text or a JSON array string.',
    example: 'hr@example.com,recruiter@example.com',
    type: [String],
  })
  @Transform(transformMailIds)
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  mailIds: string[];

  @ApiPropertyOptional({ example: '665df8d2f98f48bd8f04f2a1' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Optional from address to use for this send' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'TTL for the provided from address in seconds (stored in DB)', example: 604800 })
  @IsOptional()
  @IsString()
  fromTtlSeconds?: string;
}
