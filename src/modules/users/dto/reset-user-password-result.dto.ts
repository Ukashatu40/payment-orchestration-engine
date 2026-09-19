// src/modules/users/dto/reset-user-password-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class ResetUserPasswordResultDto {
  @ApiProperty()
  reset!: boolean;
}
