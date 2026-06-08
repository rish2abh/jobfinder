import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class EditTemplateDto {
  @ApiProperty({
    description: 'Email subject line (max 200 characters)',
    example: 'Application for {{title}} role at {{company}}',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  subject: string;

  @ApiProperty({
    description: 'Email body content (max 2000 characters). Use {{name}}, {{company}}, {{title}} as placeholders.',
    example: 'Hi {{name}}, I came across your work at {{company}}...',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  body: string;
}
