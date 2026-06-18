import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class GroupContactsDto {
  @ApiProperty({
    description: 'Grouping mode — group contacts by title or company',
    enum: ['title', 'company'],
    example: 'title',
  })
  @IsEnum(['title', 'company'])
  groupBy: 'title' | 'company';

  @ApiPropertyOptional({
    description: 'Optional array of contact IDs to group. If omitted, groups all contacts for the user.',
    example: ['665df8d2f98f48bd8f04f2a1'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactIds?: string[];
}
