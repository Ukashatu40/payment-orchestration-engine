// src/modules/gateways/adapters/stripe.adapter.ts

import { Injectable } from '@nestjs/common';
import { BaseMockAdapter } from './base-mock.adapter';
import { MockResponse } from './mock-control.enum';
import {
  IGatewayAdapter,
  GatewayAuthRequest,
  GatewayAuthResponse,
  GatewayCaptureRequest,
  GatewayCaptureResponse,
  GatewayRefundRequest,
  GatewayRefundResponse,
  GatewayVoidRequest,
  GatewayVoidResponse,
  GatewayStatusResponse,
} from './gateway.interface';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';

@Injectable()
export class StripeAdapter extends BaseMockAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.STRIPE;
  readonly supportedMethods = [PaymentMethod.CARD_CREDIT, PaymentMethod.CARD_DEBIT];

  constructor() {
    super(StripeAdapter.name);
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const control = this.getMockControl(req.metadata);
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    if (control.mockResponse === MockResponse.DECLINE) {
      return {
        gatewayPaymentId: this.generateId('pi'),
        gatewayReference: this.generateId('ref'),
        status: 'declined',
        rawResponse: {
          error: {
            type: 'card_error',
            code: 'card_declined',
            decline_code: 'insufficient_funds',
            message: 'Your card has insufficient funds.',
          },
        },
      };
    }

    const intentId = this.generateId('pi');

    return {
      gatewayPaymentId: intentId,
      gatewayOrderId: intentId,
      gatewayReference: intentId,
      status: 'authorised',
      rawResponse: {
        id: intentId,
        amount: Number(req.amountPaise),
        currency: req.currency.toLowerCase(),
        status: 'requires_capture',
        // Stripe uses Idempotency-Key header — stored for reference
        idempotency_key: req.idempotencyKey,
      },
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    return {
      gatewayReference: req.gatewayPaymentId,
      capturedAmountPaise: req.amountPaise,
      status: 'captured',
      rawResponse: {
        id: req.gatewayPaymentId,
        amount_received: Number(req.amountPaise),
        status: 'succeeded',
      },
    };
  }

  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    const refundId = this.generateId('re');

    return {
      gatewayRefundId: refundId,
      status: 'refunded',
      rawResponse: {
        id: refundId,
        payment_intent: req.gatewayPaymentId,
        amount: Number(req.amountPaise),
        status: 'succeeded',
      },
    };
  }

  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    return {
      status: 'voided',
      rawResponse: {
        id: req.gatewayPaymentId,
        status: 'canceled',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string): Promise<GatewayStatusResponse> {
    return {
      gatewayPaymentId,
      status: 'captured',
      amountPaise: BigInt(0),
      rawResponse: { id: gatewayPaymentId, status: 'succeeded' },
    };
  }
}
