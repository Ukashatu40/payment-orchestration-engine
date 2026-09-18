// src/modules/gateways/gateways.module.ts

import { Module } from '@nestjs/common';
import { RazorpayAdapter } from './adapters/razorpay.adapter';
import { StripeAdapter } from './adapters/stripe.adapter';
import { PayUAdapter } from './adapters/payu.adapter';
import { UpiAdapter } from './adapters/upi.adapter';
import { PaystackAdapter } from './adapters/paystack.adapter';
import { FlutterwaveAdapter } from './adapters/flutterwave.adapter';
import { InterswitchAdapter } from './adapters/interswitch.adapter';
import { OpayAdapter } from './adapters/opay.adapter';
import { GatewayAdapterRegistry } from './adapters/gateway-adapter.registry';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { GatewayHealthService } from './health/gateway-health.service';
import { GatewayRouterService } from './router/gateway-router.service';
import { GatewayConfigRepository } from './repositories/gateway-config.repository';
import { GatewaysController } from './gateways.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  providers: [
    // Adapters
    RazorpayAdapter,
    StripeAdapter,
    PayUAdapter,
    UpiAdapter,
    PaystackAdapter,
    FlutterwaveAdapter,
    InterswitchAdapter,
    OpayAdapter,
    GatewayAdapterRegistry,
    // Services
    CircuitBreakerService,
    GatewayHealthService,
    GatewayRouterService,
    // Repositories
    GatewayConfigRepository,
  ],
  controllers: [GatewaysController],
  exports: [
    GatewayAdapterRegistry,
    CircuitBreakerService,
    GatewayHealthService,
    GatewayRouterService,
    GatewayConfigRepository,
  ],
})
export class GatewaysModule {}
