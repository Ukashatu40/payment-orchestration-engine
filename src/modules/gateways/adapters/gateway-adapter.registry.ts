// src/modules/gateways/adapters/gateway-adapter.registry.ts

import { Injectable } from '@nestjs/common';
import { IGatewayAdapter } from './gateway.interface';
import { RazorpayAdapter } from './razorpay.adapter';
import { StripeAdapter } from './stripe.adapter';
import { PayUAdapter } from './payu.adapter';
import { UpiAdapter } from './upi.adapter';
import { PaystackAdapter } from './paystack.adapter';
import { FlutterwaveAdapter } from './flutterwave.adapter';
import { InterswitchAdapter } from './interswitch.adapter';
import { OpayAdapter } from './opay.adapter';
import { PaymentGateway } from '../../../common/enums';

@Injectable()
export class GatewayAdapterRegistry {
  private readonly adapters: Map<PaymentGateway, IGatewayAdapter>;

  constructor(
    private readonly razorpay: RazorpayAdapter,
    private readonly stripe: StripeAdapter,
    private readonly payU: PayUAdapter,
    private readonly upi: UpiAdapter,
    private readonly paystack: PaystackAdapter,
    private readonly flutterwave: FlutterwaveAdapter,
    private readonly interswitch: InterswitchAdapter,
    private readonly opay: OpayAdapter,
  ) {
    this.adapters = new Map<PaymentGateway, IGatewayAdapter>([
      [PaymentGateway.RAZORPAY, this.razorpay],
      [PaymentGateway.STRIPE, this.stripe],
      [PaymentGateway.PAYU, this.payU],
      [PaymentGateway.UPI, this.upi],
      [PaymentGateway.PAYSTACK, this.paystack],
      [PaymentGateway.FLUTTERWAVE, this.flutterwave],
      [PaymentGateway.INTERSWITCH, this.interswitch],
      [PaymentGateway.OPAY, this.opay],
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
