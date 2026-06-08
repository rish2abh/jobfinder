import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class TriggerBulkSendDto {
  @ApiProperty({
    description: 'Array of group IDs to send emails for',
    example: ['665df8d2f98f48bd8f04f2a1'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  groupIds: string[];

  @ApiPropertyOptional({
    description: 'Optional custom sender email address',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Optional Cloudinary resume URL to attach',
    example: 'https://res.cloudinary.com/xxx/resume.pdf',
  })
  @IsOptional()
  @IsString()
  resumeUrl?: string;
}
