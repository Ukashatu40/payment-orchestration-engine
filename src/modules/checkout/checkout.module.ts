// src/modules/checkout/checkout.module.ts

import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { GatewaysModule } from '../gateways/gateways.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [TransactionsModule, GatewaysModule, WebhooksModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
