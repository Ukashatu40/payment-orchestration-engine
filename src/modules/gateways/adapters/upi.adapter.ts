// src/modules/gateways/adapters/upi.adapter.ts

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
export class UpiAdapter extends BaseMockAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.UPI;
  readonly supportedMethods = [PaymentMethod.UPI];

  // UPI mandate window — 5 minutes (FS-12)
  private readonly MANDATE_WINDOW_MS = 5 * 60 * 1000;

  constructor() {
    super(UpiAdapter.name);
  }

  // UPI is instant — no separate capture phase (Section A1.3)
  // authorise() initiates the collect request and waits for approval
  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const control = this.getMockControl(req.metadata);
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    if (control.mockResponse === MockResponse.DECLINE) {
      return {
        gatewayPaymentId: this.generateId('upi'),
        gatewayReference: this.generateId('ref'),
        status: 'declined',
        rawResponse: {
          status: 'FAILURE',
          responseCode: 'U30',
          responseMessage: 'Transaction declined by customer.',
        },
      };
    }

    const txnRef = this.generateId('UPI');

    return {
      gatewayPaymentId: txnRef,
      gatewayReference: txnRef,
      // UPI is instant — returns captured directly
      status: 'authorised',
      rawResponse: {
        txnRef,
        amount: Number(req.amountPaise) / 100,
        status: 'SUCCESS',
        responseCode: '00',
        // UPI mandate expiry for FS-12 simulation
        mandateExpiresAt: new Date(Date.now() + this.MANDATE_WINDOW_MS).toISOString(),
      },
    };
  }

  // UPI has no separate capture — method exists to satisfy interface
  // Real UPI transactions capture at authorise time (Section A1.3)
  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    return {
      gatewayReference: req.gatewayPaymentId,
      capturedAmountPaise: req.amountPaise,
      status: 'captured',
      rawResponse: {
        txnRef: req.gatewayPaymentId,
        note: 'UPI captures instantly at authorisation',
      },
    };
  }

  // UPI does not support partial refunds (Section A1.3)
  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const control = this.getMockControl();
    await this.applyMockBehaviour(this.gateway, req.transactionId, control);

    const refundRef = this.generateId('UPIREF');

    return {
      gatewayRefundId: refundRef,
      status: 'refunded',
      rawResponse: {
        refundRef,
        originalTxnRef: req.gatewayPaymentId,
        status: 'SUCCESS',
      },
    };
  }

  // UPI does not support void — method exists to satisfy interface
  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    return {
      status: 'voided',
      rawResponse: {
        note: 'UPI collect requests expire automatically after mandate window',
        txnRef: req.gatewayPaymentId,
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string): Promise<GatewayStatusResponse> {
    return {
      gatewayPaymentId,
      status: 'captured',
      amountPaise: BigInt(0),
      rawResponse: {
        txnRef: gatewayPaymentId,
        status: 'SUCCESS',
        responseCode: '00',
      },
    };
  }
}
