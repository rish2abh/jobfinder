import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class MongoIdParamDto {
  @ApiProperty({ example: '665df8d2f98f48bd8f04f2a1' })
  @IsMongoId()
  id: string;
}
