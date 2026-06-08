import { IsMongoId, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TriggerApplyDto {
  @ApiProperty({ description: 'The job listing ID to apply to' })
  @IsMongoId()
  @IsNotEmpty()
  jobId: string;
}
