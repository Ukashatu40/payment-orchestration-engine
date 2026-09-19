// src/modules/auth/dto/revoke-session-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';

export class RevokeSessionResultDto {
  @ApiProperty()
  revoked!: boolean;
}
