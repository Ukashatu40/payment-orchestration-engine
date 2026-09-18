// src/modules/users/dto/list-users-response.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { UserSummaryDto } from './user-summary.dto';

export class ListUsersResponseDto {
  @ApiProperty({ type: [UserSummaryDto] })
  data!: UserSummaryDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}
