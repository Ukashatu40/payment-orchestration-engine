// src/modules/gateways/adapters/payu.adapter.ts

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
export class PayUAdapter extends BaseMockAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.PAYU;
  readonly supportedMethods = [
    PaymentMethod.CARD_CREDIT,
    PaymentMethod.CARD_DEBIT,
    PaymentMethod.NET_BANKING,
    PaymentMethod.WALLET,
  ];

  constructor() {
    super(PayUAdapter.name);
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const control = this.getMockControl(req.metadata);
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    if (control.mockResponse === MockResponse.DECLINE) {
      return {
        gatewayPaymentId: this.generateId('payu'),
        gatewayReference: this.generateId('ref'),
        status: 'declined',
        rawResponse: {
          status: 'failed',
          error_code: 'E001',
          error_message: 'Transaction declined by issuing bank.',
        },
      };
    }

    const txnId = this.generateId('payu');

    return {
      gatewayPaymentId: txnId,
      gatewayOrderId: req.idempotencyKey, // PayU uses txnid for idempotency
      gatewayReference: txnId,
      status: 'authorised',
      rawResponse: {
        txnid: txnId,
        amount: Number(req.amountPaise) / 100,
        status: 'authorized',
        mode: req.paymentMethod,
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
        txnid: req.gatewayPaymentId,
        status: 'captured',
        amount: Number(req.amountPaise) / 100,
      },
    };
  }

  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    const refundId = this.generateId('payu_rfnd');

    return {
      gatewayRefundId: refundId,
      status: 'refunded',
      rawResponse: {
        refundId,
        txnid: req.gatewayPaymentId,
        status: 'REFUNDED',
      },
    };
  }

  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    return {
      status: 'voided',
      rawResponse: {
        txnid: req.gatewayPaymentId,
        status: 'cancelled',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string): Promise<GatewayStatusResponse> {
    return {
      gatewayPaymentId,
      status: 'captured',
      amountPaise: BigInt(0),
      rawResponse: { txnid: gatewayPaymentId, status: 'captured' },
    };
  }
}
