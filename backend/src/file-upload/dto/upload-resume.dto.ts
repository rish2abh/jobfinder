import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString } from 'class-validator';

export class UploadResumeDto {
  @ApiProperty({ example: '665df8d2f98f48bd8f04f2a1' })
  @IsMongoId()
  userId: string;

  @ApiPropertyOptional({ example: 'local' })
  @IsOptional()
  @IsString()
  source?: string;
}
