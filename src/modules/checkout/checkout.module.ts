// src/modules/checkout/checkout.module.ts

import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { GatewaysModule } from '../gateways/gateways.module';

@Module({
  imports: [TransactionsModule, GatewaysModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
