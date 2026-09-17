// src/modules/gateways/adapters/opay.adapter.ts

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
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
import { GatewayConfig } from '../entities/gateway-config.entity';

interface OpayResponse {
  code: string;
  message: string;
  data?: {
    orderNo?: string;
    reference?: string;
    status?: string;
    refundNo?: string;
    amount?: { total?: number; currency?: string };
  };
}

// ----------------------------------------------------------------
// Opay signs every request body with HMAC-SHA512 using the merchant's
// secret key, sent as `Authorization: Bearer <signature>` alongside a
// `MerchantId` header — unlike Paystack/Flutterwave's static bearer
// token. Credential layout chosen for this adapter: gateway_config.
// api_key holds the Opay MerchantId, gateway_config.metadata.secretKey
// holds the signing secret (seeded via scripts/seed-gateway-secrets.ts
// — see README).
//
// Cashier/Checkout is also redirect-based (returns a cashierUrl for
// the payer), so authorise() returns 'pending' and completion is
// webhook-driven, same as Paystack/Flutterwave.
//
// Endpoint paths/response field names/signing canonicalization below
// are a best-effort implementation and MUST be reconfirmed against
// Opay's current merchant API docs before production use — this is
// the least standardized of the four integrations.
// ----------------------------------------------------------------
@Injectable()
export class OpayAdapter extends BaseHttpAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.OPAY;
  readonly supportedMethods = [
    PaymentMethod.CARD_CREDIT,
    PaymentMethod.CARD_DEBIT,
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.MOBILE_MONEY,
  ];

  constructor(gatewayConfigRepo: GatewayConfigRepository) {
    super(OpayAdapter.name, PaymentGateway.OPAY, gatewayConfigRepo);
  }

  private sign(bodyJson: string, secretKey: string): string {
    return crypto.createHmac('sha512', secretKey).update(bodyJson).digest('hex');
  }

  private authHeaders(config: GatewayConfig, bodyJson: string): Record<string, string> {
    const secretKey = (config.metadata?.['secretKey'] as string) ?? '';

    return {
      Authorization: `Bearer ${this.sign(bodyJson, secretKey)}`,
      MerchantId: config.apiKey ?? '',
      'Content-Type': 'application/json',
    };
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const config = await this.loadConfig();
    // The confirmed Opay callback payload (doc.opaycheckout.com/
    // callback-signature) has no metadata passthrough field — it only
    // echoes back `reference`. So our transactionId IS the reference
    // sent to Opay, letting the webhook processor resolve it directly
    // via payload.payload.reference — no metadata round-trip needed.
    const reference = req.transactionId;

    const payload = {
      country: 'NG',
      reference,
      amount: { total: Number(req.amountPaise), currency: req.currency }, // kobo
      payMethods: ['BankCard'],
      metadata: {
        idempotency_key: req.idempotencyKey,
      },
    };
    const bodyJson = JSON.stringify(payload);

    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/cashier/create', payload),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayPaymentId: data.orderNo ?? reference,
      gatewayReference: data.reference ?? reference,
      status: 'pending',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const config = await this.loadConfig();
    const payload = { orderNo: req.gatewayPaymentId };
    const bodyJson = JSON.stringify(payload);
    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/cashier/status', payload),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const captured = data.status === 'SUCCESS';

    return {
      gatewayReference: req.gatewayPaymentId,
      capturedAmountPaise: captured ? req.amountPaise : BigInt(0),
      status: captured ? 'captured' : 'failed',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const config = await this.loadConfig();
    const payload = {
      orderNo: req.gatewayPaymentId,
      refundAmount: { total: Number(req.amountPaise), currency: req.currency },
      refundReason: req.reason ?? 'merchant_requested',
    };
    const bodyJson = JSON.stringify(payload);
    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/refund/create', payload),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayRefundId: data.refundNo ?? this.generateId('opay_rfnd'),
      status: 'refunded',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- IGatewayAdapter.void is async; this implementation never awaits
  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    this.logger.warn('Void requested but Opay has no documented cancel API for a created order', {
      transactionId: req.transactionId,
      gatewayPaymentId: req.gatewayPaymentId,
    });

    return {
      status: 'failed',
      rawResponse: {
        error: 'Opay does not support voiding a created order',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string, traceId: string): Promise<GatewayStatusResponse> {
    const config = await this.loadConfig();
    const payload = { orderNo: gatewayPaymentId };
    const bodyJson = JSON.stringify(payload);
    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/cashier/status', payload),
      traceId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const statusMap: Record<string, GatewayStatusResponse['status']> = {
      SUCCESS: 'captured',
      FAIL: 'failed',
      PENDING: 'authorised',
      CLOSE: 'expired',
    };

    return {
      gatewayPaymentId,
      status: (data.status ? statusMap[data.status] : undefined) ?? 'failed',
      amountPaise: data.amount?.total !== undefined ? BigInt(data.amount.total) : BigInt(0),
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }
}
