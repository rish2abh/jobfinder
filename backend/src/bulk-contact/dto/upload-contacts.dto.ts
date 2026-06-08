import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadContactsDto {
  @ApiPropertyOptional({
    description: 'Original filename (populated automatically from multipart upload)',
  })
  @IsOptional()
  @IsString()
  filename?: string;
}
