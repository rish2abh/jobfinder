import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class GroupContactsDto {
  @ApiProperty({
    description: 'Grouping mode — group contacts by title or company',
    enum: ['title', 'company'],
    example: 'title',
  })
  @IsEnum(['title', 'company'])
  groupBy: 'title' | 'company';
}
