// src/modules/gateways/adapters/paystack.adapter.ts

import { Injectable } from '@nestjs/common';
import { BaseHttpAdapter } from './base-http.adapter';
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
import { GatewayConfigRepository } from '../repositories/gateway-config.repository';

interface PaystackResponse {
  status: boolean;
  message: string;
  data?: {
    reference?: string;
    authorization_url?: string;
    status?: string;
    amount?: number;
    id?: number | string;
  };
}

// ----------------------------------------------------------------
// Paystack's Initialize Transaction API is redirect-based — it
// returns an authorization_url for the payer to complete payment on,
// not a synchronous authorised/declined result. authorise() therefore
// returns status: 'pending'; the transaction stays in AUTH_INITIATED
// until the Paystack webhook (charge.success) drives it forward via
// webhook-processor.service.ts. Paystack also auto-captures on charge
// success, so capture() is a verify-and-confirm call rather than a
// distinct capture step.
//
// Endpoint paths/response field names below reflect Paystack's public
// API as of implementation time — reconfirm against
// https://paystack.com/docs before relying on this in production, as
// third-party API surfaces evolve independently of this codebase.
// ----------------------------------------------------------------
@Injectable()
export class PaystackAdapter extends BaseHttpAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.PAYSTACK;
  readonly supportedMethods = [
    PaymentMethod.CARD_CREDIT,
    PaymentMethod.CARD_DEBIT,
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.USSD,
    PaymentMethod.VIRTUAL_ACCOUNT,
  ];

  constructor(gatewayConfigRepo: GatewayConfigRepository) {
    super(PaystackAdapter.name, PaymentGateway.PAYSTACK, gatewayConfigRepo);
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    });

    const reference = this.generateId('psk');

    const body = await this.request<PaystackResponse>(
      () =>
        http.post<PaystackResponse>('/transaction/initialize', {
          // Paystack requires a customer email and validates it against
          // a real-looking TLD — RFC 2606 "guaranteed invalid" domains
          // like *.invalid are correctly rejected by Paystack's own
          // validator, so the placeholder fallback (used only when the
          // caller didn't supply a real customerEmail) must use a
          // syntactically-plausible domain instead.
          email: req.customerEmail ?? `${req.merchantId}@merchant.payflow.com`,
          amount: req.amountPaise.toString(), // kobo — no conversion needed
          currency: req.currency,
          reference,
          metadata: {
            transaction_id: req.transactionId,
            idempotency_key: req.idempotencyKey,
          },
        }),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayPaymentId: data.reference ?? reference,
      gatewayReference: data.reference ?? reference,
      status: 'pending',
      checkoutUrl: data.authorization_url,
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
    });

    const body = await this.request<PaystackResponse>(
      () =>
        http.get<PaystackResponse>(
          `/transaction/verify/${encodeURIComponent(req.gatewayPaymentId)}`,
        ),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const captured = data.status === 'success';

    return {
      gatewayReference: req.gatewayPaymentId,
      capturedAmountPaise: captured ? req.amountPaise : BigInt(0),
      status: captured ? 'captured' : 'failed',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    });

    const body = await this.request<PaystackResponse>(
      () =>
        http.post<PaystackResponse>('/refund', {
          transaction: req.gatewayPaymentId,
          amount: req.amountPaise.toString(),
        }),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayRefundId: data.id !== undefined ? String(data.id) : this.generateId('psk_rfnd'),
      status: 'refunded',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- IGatewayAdapter.void is async; this implementation never awaits
  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    // Paystack has no documented void/cancel endpoint for an
    // already-initialized transaction — confirm against current docs
    // before assuming this is still true.
    this.logger.warn('Void requested but Paystack has no cancel API for initialized transactions', {
      transactionId: req.transactionId,
      gatewayPaymentId: req.gatewayPaymentId,
    });

    return {
      status: 'failed',
      rawResponse: {
        error: 'Paystack does not support voiding an initialized transaction',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string, traceId: string): Promise<GatewayStatusResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
    });

    const body = await this.request<PaystackResponse>(
      () =>
        http.get<PaystackResponse>(`/transaction/verify/${encodeURIComponent(gatewayPaymentId)}`),
      traceId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const statusMap: Record<string, GatewayStatusResponse['status']> = {
      success: 'captured',
      failed: 'failed',
      abandoned: 'expired',
    };

    return {
      gatewayPaymentId,
      status: (data.status ? statusMap[data.status] : undefined) ?? 'failed',
      amountPaise: data.amount !== undefined ? BigInt(data.amount) : BigInt(0),
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }
}
