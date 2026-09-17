// src/modules/gateways/adapters/flutterwave.adapter.ts

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

interface FlutterwaveResponse {
  status: string;
  message: string;
  data?: {
    id?: number;
    status?: string;
    amount?: number;
  };
}

// ----------------------------------------------------------------
// Same redirect/async shape as Paystack — Flutterwave's Standard
// Payment API returns a hosted checkout link, not a synchronous
// result, so authorise() returns 'pending' and the webhook
// (charge.completed) drives completion.
//
// Unlike Paystack (kobo-native), Flutterwave's v3 API takes/returns
// `amount` in MAJOR currency units (naira, e.g. "5000" = ₦5000, not
// 500000 kobo) — this adapter converts amountPaise (kobo) to naira on
// the way out and back to kobo on the way in (see
// webhook-processor.service.ts extractAmount), the same conversion
// PayU already needs for INR. Do not assume this is kobo-native like
// the other three NGN gateways.
//
// gatewayPaymentId/gatewayReference are set to the tx_ref WE generate
// (Flutterwave's own internal transaction id isn't known until the
// webhook delivers it as data.id). refund() below uses
// gatewayPaymentId as Flutterwave's transaction id, which only holds
// if the webhook pipeline updates it post-authorisation — confirm
// this wiring against the actual webhook payload during
// implementation before relying on refund() in production.
//
// Endpoint paths/response field names reflect Flutterwave's public v3
// API as of implementation time — reconfirm against
// https://developer.flutterwave.com/docs before production use.
// ----------------------------------------------------------------
@Injectable()
export class FlutterwaveAdapter extends BaseHttpAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.FLUTTERWAVE;
  readonly supportedMethods = [
    PaymentMethod.CARD_CREDIT,
    PaymentMethod.CARD_DEBIT,
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.USSD,
    PaymentMethod.MOBILE_MONEY,
  ];

  constructor(gatewayConfigRepo: GatewayConfigRepository) {
    super(FlutterwaveAdapter.name, PaymentGateway.FLUTTERWAVE, gatewayConfigRepo);
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    });

    const txRef = this.generateId('flw');

    const body = await this.request<FlutterwaveResponse>(
      () =>
        http.post<FlutterwaveResponse>('/payments', {
          tx_ref: txRef,
          amount: (Number(req.amountPaise) / 100).toString(), // kobo → naira
          currency: req.currency,
          customer: {
            email: `${req.merchantId}@merchant.payflow.invalid`,
          },
          meta: {
            transaction_id: req.transactionId,
            idempotency_key: req.idempotencyKey,
          },
        }),
      req.transactionId,
      config.timeoutMs,
    );

    return {
      gatewayPaymentId: txRef,
      gatewayReference: txRef,
      status: 'pending',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
    });

    const body = await this.request<FlutterwaveResponse>(
      () =>
        http.get<FlutterwaveResponse>('/transactions/verify_by_reference', {
          params: { tx_ref: req.gatewayPaymentId },
        }),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const captured = data.status === 'successful';

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

    const body = await this.request<FlutterwaveResponse>(
      () =>
        http.post<FlutterwaveResponse>(
          `/transactions/${encodeURIComponent(req.gatewayPaymentId)}/refund`,
          {
            amount: (Number(req.amountPaise) / 100).toString(), // kobo → naira
          },
        ),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayRefundId: data.id !== undefined ? String(data.id) : this.generateId('flw_rfnd'),
      status: 'refunded',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- IGatewayAdapter.void is async; this implementation never awaits
  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    // No documented void/cancel endpoint for an already-initiated
    // Flutterwave transaction — confirm against current docs.
    this.logger.warn('Void requested but Flutterwave has no documented cancel API', {
      transactionId: req.transactionId,
      gatewayPaymentId: req.gatewayPaymentId,
    });

    return {
      status: 'failed',
      rawResponse: {
        error: 'Flutterwave does not support voiding an initiated transaction',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string, traceId: string): Promise<GatewayStatusResponse> {
    const config = await this.loadConfig();
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${config.apiKey}`,
    });

    const body = await this.request<FlutterwaveResponse>(
      () =>
        http.get<FlutterwaveResponse>('/transactions/verify_by_reference', {
          params: { tx_ref: gatewayPaymentId },
        }),
      traceId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const statusMap: Record<string, GatewayStatusResponse['status']> = {
      successful: 'captured',
      failed: 'failed',
      pending: 'authorised',
    };

    return {
      gatewayPaymentId,
      status: (data.status ? statusMap[data.status] : undefined) ?? 'failed',
      // Flutterwave returns amount in naira (major units) — convert
      // back to kobo to match this codebase's minor-unit convention.
      amountPaise: data.amount !== undefined ? BigInt(Math.round(data.amount * 100)) : BigInt(0),
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }
}
