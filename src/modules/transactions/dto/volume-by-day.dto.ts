// src/modules/transactions/dto/volume-by-day.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class VolumeByDayDto {
  @ApiProperty({ description: 'YYYY-MM-DD' })
  date!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty({ description: 'Sum of amount_paise for the day, as a string (bigint-safe)' })
  totalPaise!: string;
}
