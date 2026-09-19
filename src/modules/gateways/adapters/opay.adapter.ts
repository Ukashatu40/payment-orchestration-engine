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
import { GatewayUnavailableException } from '../../../common/exceptions';

interface OpayResponse {
  code: string;
  message: string;
  data?: {
    orderNo?: string;
    reference?: string;
    status?: string;
    refundNo?: string;
    cashierUrl?: string;
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
// Endpoints follow doc.opaycheckout.com (all under
// /api/v1/international/...). cashier/create authenticates with the
// merchant PUBLIC key as the Bearer token; every other call uses the
// HMAC-SHA512 body signature. Extra metadata keys read by this adapter:
//   publicKey  — Bearer token for cashier/create
//   returnUrl  — page the payer's browser returns to (required; may use
//                {transactionId}), NOT the webhook route
//   cancelUrl  — optional page for cancelled checkouts
//   callbackUrl — https://<host>/api/v1/webhooks/opay, where Opay POSTs
//                the payment notification (without it payments stay pending)
// Signing canonicalization and the exact envelope of the status/refund
// responses are only partly covered by the docs — verify against the
// sandbox before production.
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

  private requireMetadata(config: GatewayConfig, key: string): string {
    const value = config.metadata?.[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new GatewayUnavailableException(
        this.gateway,
        `Opay gateway_config.metadata.${key} is not set — seed it with scripts/seed-gateway-secrets.ts`,
      );
    }
    return value;
  }

  // URL settings may contain a {transactionId} placeholder. returnUrl/
  // cancelUrl are where the payer's BROWSER is sent (a GET to a page);
  // callbackUrl is where Opay POSTs the server-to-server notification
  // (the /api/v1/webhooks/opay route). Mixing them up sends the browser
  // to the POST-only webhook route.
  private metadataUrl(
    config: GatewayConfig,
    key: string,
    transactionId: string,
    required = false,
  ): string | undefined {
    const raw = required ? this.requireMetadata(config, key) : config.metadata?.[key];
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    return raw.replaceAll('{transactionId}', transactionId);
  }

  private optionalUrl(key: string, value: string | undefined): Record<string, string> {
    return value ? { [key]: value } : {};
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const config = await this.loadConfig();
    // The confirmed Opay callback payload (doc.opaycheckout.com/
    // callback-signature) has no metadata passthrough field — it only
    // echoes back `reference`. So our transactionId IS the reference
    // sent to Opay, letting the webhook processor resolve it directly
    // via payload.payload.reference — no metadata round-trip needed.
    const reference = req.transactionId;

    if (!config.metadata?.['callbackUrl']) {
      this.logger.warn(
        'Opay gateway_config.metadata.callbackUrl is not set — Opay will not know where to POST payment notifications, so payments will stay pending',
      );
    }

    const payload = {
      country: 'NG',
      reference,
      amount: { total: Number(req.amountPaise), currency: req.currency }, // kobo
      returnUrl: this.metadataUrl(config, 'returnUrl', reference, true),
      ...this.optionalUrl('callbackUrl', this.metadataUrl(config, 'callbackUrl', reference)),
      ...this.optionalUrl('cancelUrl', this.metadataUrl(config, 'cancelUrl', reference)),
      product: { name: 'Payment', description: `Order ${reference}` },
      ...(req.customerEmail && { userInfo: { userEmail: req.customerEmail } }),
    };

    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${this.requireMetadata(config, 'publicKey')}`,
      MerchantId: config.apiKey ?? '',
      'Content-Type': 'application/json',
    });

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/international/cashier/create', payload),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayPaymentId: data.orderNo ?? reference,
      gatewayReference: data.reference ?? reference,
      status: 'pending',
      checkoutUrl: data.cashierUrl,
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const config = await this.loadConfig();
    const payload = { country: 'NG', orderNo: req.gatewayPaymentId };
    const bodyJson = JSON.stringify(payload);
    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/international/cashier/status', payload),
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
    // The original payment's merchant reference IS the transactionId
    // (see authorise()), which is what Opay's refund API keys on.
    const payload = {
      country: 'NG',
      reference: this.generateId('opay_rfnd'),
      originalReference: req.transactionId,
      amount: { total: Number(req.amountPaise), currency: req.currency },
      refundReason: req.reason ?? 'merchant_requested',
    };
    const bodyJson = JSON.stringify(payload);
    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/international/payment/refund/create', payload),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayRefundId: data.orderNo ?? data.refundNo ?? payload.reference,
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
    const payload = { country: 'NG', orderNo: gatewayPaymentId };
    const bodyJson = JSON.stringify(payload);
    const http = this.buildHttpClient(config, this.authHeaders(config, bodyJson));

    const body = await this.request<OpayResponse>(
      () => http.post<OpayResponse>('/api/v1/international/cashier/status', payload),
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
