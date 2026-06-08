import { IsArray, IsMongoId, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BatchApplyDto {
  @ApiProperty({
    description: 'Array of job listing IDs to apply to (max 50)',
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  jobIds: string[];
}
