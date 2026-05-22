// src/modules/gateways/adapters/razorpay.adapter.ts

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
export class RazorpayAdapter extends BaseMockAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.RAZORPAY;
  readonly supportedMethods = [
    PaymentMethod.CARD_CREDIT,
    PaymentMethod.CARD_DEBIT,
    PaymentMethod.NET_BANKING,
    PaymentMethod.WALLET,
  ];

  constructor() {
    super(RazorpayAdapter.name);
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const control = this.getMockControl(req.metadata);
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    // Simulate decline response
    if (control.mockResponse === MockResponse.DECLINE) {
      return {
        gatewayPaymentId: this.generateId('pay'),
        gatewayReference: this.generateId('ref'),
        status: 'declined',
        rawResponse: {
          error: {
            code: 'BAD_REQUEST_ERROR',
            description: 'The card issuer has declined this transaction.',
            source: 'issuer',
            step: 'payment_authorization',
            reason: 'do_not_honour',
          },
        },
      };
    }

    const paymentId = this.generateId('pay');
    const orderId = this.generateId('order');

    return {
      gatewayPaymentId: paymentId,
      gatewayOrderId: orderId,
      gatewayReference: paymentId,
      status: 'authorised',
      rawResponse: {
        id: paymentId,
        order_id: orderId,
        amount: Number(req.amountPaise),
        currency: req.currency,
        status: 'authorized',
        method: req.paymentMethod.toLowerCase(),
      },
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    const reference = this.generateId('cap');

    return {
      gatewayReference: reference,
      capturedAmountPaise: req.amountPaise,
      status: 'captured',
      rawResponse: {
        id: req.gatewayPaymentId,
        amount: Number(req.amountPaise),
        status: 'captured',
      },
    };
  }

  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    const refundId = this.generateId('rfnd');

    return {
      gatewayRefundId: refundId,
      status: 'refunded',
      rawResponse: {
        id: refundId,
        payment_id: req.gatewayPaymentId,
        amount: Number(req.amountPaise),
        status: 'processed',
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
        status: 'cancelled',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string, traceId: string): Promise<GatewayStatusResponse> {
    return {
      gatewayPaymentId,
      status: 'captured',
      amountPaise: BigInt(0),
      rawResponse: { id: gatewayPaymentId, status: 'captured' },
    };
  }
}
