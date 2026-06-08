import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class GenerateTemplatesDto {
  @ApiProperty({
    description: 'Array of group IDs to generate templates for',
    example: ['665df8d2f98f48bd8f04f2a1'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  groupIds: string[];

  @ApiPropertyOptional({
    description: 'Optional user prompt/context to guide AI template generation',
    example: 'I am looking for backend developer roles and want a professional tone',
  })
  @IsOptional()
  @IsString()
  userPrompt?: string;
}
