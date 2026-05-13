// src/modules/gateways/adapters/gateway.interface.ts

import { PaymentGateway, PaymentMethod } from '../../../common/enums';

// ----------------------------------------------------------------
// Request / Response shapes
// ----------------------------------------------------------------

export interface GatewayAuthRequest {
  transactionId: string;
  merchantId: string;
  amountPaise: bigint;
  currency: string;
  paymentMethod: PaymentMethod;
  traceId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayAuthResponse {
  gatewayPaymentId: string;
  gatewayOrderId?: string;
  gatewayReference: string;
  status: 'authorised' | 'declined' | 'pending';
  rawResponse: Record<string, unknown>;
}

export interface GatewayCaptureRequest {
  transactionId: string;
  gatewayPaymentId: string;
  amountPaise: bigint; // may be less than auth amount (FS-05)
  currency: string;
  traceId: string;
}

export interface GatewayCaptureResponse {
  gatewayReference: string;
  capturedAmountPaise: bigint;
  status: 'captured' | 'partially_captured' | 'failed';
  rawResponse: Record<string, unknown>;
}

export interface GatewayRefundRequest {
  transactionId: string;
  refundId: string;
  gatewayPaymentId: string;
  amountPaise: bigint;
  currency: string;
  reason?: string;
  traceId: string;
}

export interface GatewayRefundResponse {
  gatewayRefundId: string;
  status: 'refunded' | 'partially_refunded' | 'failed';
  rawResponse: Record<string, unknown>;
}

export interface GatewayVoidRequest {
  transactionId: string;
  gatewayPaymentId: string;
  traceId: string;
}

export interface GatewayVoidResponse {
  status: 'voided' | 'failed';
  rawResponse: Record<string, unknown>;
}

export interface GatewayStatusResponse {
  gatewayPaymentId: string;
  status: 'authorised' | 'captured' | 'failed' | 'refunded' | 'expired';
  amountPaise: bigint;
  rawResponse: Record<string, unknown>;
}

// ----------------------------------------------------------------
// The interface every adapter must implement
// ----------------------------------------------------------------

export interface IGatewayAdapter {
  readonly gateway: PaymentGateway;
  readonly supportedMethods: PaymentMethod[];

  authorise(request: GatewayAuthRequest): Promise<GatewayAuthResponse>;

  capture(request: GatewayCaptureRequest): Promise<GatewayCaptureResponse>;

  refund(request: GatewayRefundRequest): Promise<GatewayRefundResponse>;

  void(request: GatewayVoidRequest): Promise<GatewayVoidResponse>;

  // Used by reconciliation engine to poll gateway status (Section A5.5)
  fetchStatus(
    gatewayPaymentId: string,
    traceId: string,
  ): Promise<GatewayStatusResponse>;
}
