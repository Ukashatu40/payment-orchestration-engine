// src/modules/gateways/dto/gateway-config-update-result.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { PaymentGateway } from '../../../common/enums';

export class GatewayConfigUpdateResultDto {
  @ApiProperty()
  updated!: boolean;

  @ApiProperty({ enum: PaymentGateway })
  gateway!: PaymentGateway;
}
