// src/modules/gateways/adapters/gateway-adapter.registry.ts

import { Injectable } from '@nestjs/common';
import { IGatewayAdapter } from './gateway.interface';
import { RazorpayAdapter } from './razorpay.adapter';
import { StripeAdapter } from './stripe.adapter';
import { PayUAdapter } from './payu.adapter';
import { UpiAdapter } from './upi.adapter';
import { PaymentGateway } from '../../../common/enums';

@Injectable()
export class GatewayAdapterRegistry {
  private readonly adapters: Map<PaymentGateway, IGatewayAdapter>;

  constructor(
    private readonly razorpay: RazorpayAdapter,
    private readonly stripe: StripeAdapter,
    private readonly payU: PayUAdapter,
    private readonly upi: UpiAdapter,
  ) {
    this.adapters = new Map<PaymentGateway, IGatewayAdapter>([
      [PaymentGateway.RAZORPAY, this.razorpay],
      [PaymentGateway.STRIPE, this.stripe],
      [PaymentGateway.PAYU, this.payU],
      [PaymentGateway.UPI, this.upi],
    ]);
  }

  get(gateway: PaymentGateway): IGatewayAdapter {
    const adapter = this.adapters.get(gateway);
    if (!adapter) {
      throw new Error(`No adapter registered for gateway: ${gateway}`);
    }
    return adapter;
  }

  getAll(): IGatewayAdapter[] {
    return Array.from(this.adapters.values());
  }
}
