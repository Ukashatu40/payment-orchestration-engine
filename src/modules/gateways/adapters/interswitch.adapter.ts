// src/modules/gateways/adapters/interswitch.adapter.ts

import { Injectable } from '@nestjs/common';
import axios from 'axios';
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

interface InterswitchTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface InterswitchResponse {
  responseCode?: string;
  data?: {
    transactionReference?: string;
    status?: string;
    amount?: number;
    refundReference?: string;
  };
}

// ----------------------------------------------------------------
// Interswitch uses OAuth2 client-credentials — a bearer token must be
// fetched from a token endpoint before any transaction call, unlike
// Paystack/Flutterwave/Opay's per-request static/signed credentials.
// Credential layout: gateway_config.api_key holds the OAuth2 client
// ID, gateway_config.metadata.clientSecret holds the client secret.
// The resulting token is cached in-memory on this adapter instance
// with an expiry check, refreshed when it's within 60s of expiring.
//
// Interswitch's public API surface has shifted between product lines
// historically (Webpay / Quickteller / Passport) — the endpoint paths
// and response shapes below are a best-effort implementation and MUST
// be reconfirmed against Interswitch's current merchant docs before
// production use. Of the four gateways added here, this one carries
// the most implementation risk.
//
// Verve cards reuse the existing CARD_CREDIT/CARD_DEBIT payment
// methods — no separate method mapping needed.
// ----------------------------------------------------------------
@Injectable()
export class InterswitchAdapter extends BaseHttpAdapter implements IGatewayAdapter {
  readonly gateway = PaymentGateway.INTERSWITCH;
  readonly supportedMethods = [
    PaymentMethod.CARD_CREDIT,
    PaymentMethod.CARD_DEBIT,
    PaymentMethod.BANK_TRANSFER,
    PaymentMethod.USSD,
    PaymentMethod.VIRTUAL_ACCOUNT,
  ];

  private tokenCache: { accessToken: string; expiresAt: number } | null = null;

  constructor(gatewayConfigRepo: GatewayConfigRepository) {
    super(InterswitchAdapter.name, PaymentGateway.INTERSWITCH, gatewayConfigRepo);
  }

  private async getAccessToken(config: GatewayConfig): Promise<string> {
    const now = Date.now();

    if (this.tokenCache && this.tokenCache.expiresAt - 60_000 > now) {
      return this.tokenCache.accessToken;
    }

    const clientId = config.apiKey ?? '';
    const clientSecret = (config.metadata?.['clientSecret'] as string) ?? '';
    const baseURL = (config.metadata?.['baseUrl'] as string) ?? '';
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    let tokenResponse: InterswitchTokenResponse;

    try {
      // Not routed through BaseHttpAdapter.buildHttpClient — that
      // helper assumes an already-issued bearer token, which is
      // exactly what this call is fetching.
      const res = await axios.post<InterswitchTokenResponse>(
        `${baseURL}/passport/oauth/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: config.timeoutMs,
        },
      );
      tokenResponse = res.data;
    } catch {
      throw new GatewayUnavailableException(
        this.gateway,
        'Failed to obtain Interswitch OAuth2 access token',
      );
    }

    const accessToken = tokenResponse.access_token;
    const expiresInSeconds = tokenResponse.expires_in ?? 3600;

    if (!accessToken) {
      throw new GatewayUnavailableException(
        this.gateway,
        'Interswitch token response missing access_token',
      );
    }

    this.tokenCache = {
      accessToken,
      expiresAt: now + expiresInSeconds * 1000,
    };

    return accessToken;
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const config = await this.loadConfig();
    const token = await this.getAccessToken(config);
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    // The confirmed webhook payload (docs.interswitchgroup.com/v1.1/
    // docs/webhooks) echoes our reference back as data.merchantReference,
    // not a metadata passthrough field — so our transactionId IS the
    // merchant_reference sent here, letting the webhook processor
    // resolve it directly.
    const reference = req.transactionId;

    const body = await this.request<InterswitchResponse>(
      () =>
        http.post<InterswitchResponse>('/api/v2/payments', {
          merchant_reference: reference,
          amount: Number(req.amountPaise), // kobo
          currency: req.currency,
        }),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayPaymentId: data.transactionReference ?? reference,
      gatewayReference: data.transactionReference ?? reference,
      status: 'pending',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const config = await this.loadConfig();
    const token = await this.getAccessToken(config);
    const http = this.buildHttpClient(config, { Authorization: `Bearer ${token}` });

    const body = await this.request<InterswitchResponse>(
      () =>
        http.get<InterswitchResponse>(
          `/api/v2/payments/${encodeURIComponent(req.gatewayPaymentId)}`,
        ),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const captured = data.status === 'SUCCESSFUL';

    return {
      gatewayReference: req.gatewayPaymentId,
      capturedAmountPaise: captured ? req.amountPaise : BigInt(0),
      status: captured ? 'captured' : 'failed',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    const config = await this.loadConfig();
    const token = await this.getAccessToken(config);
    const http = this.buildHttpClient(config, {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    const body = await this.request<InterswitchResponse>(
      () =>
        http.post<InterswitchResponse>(
          `/api/v2/payments/${encodeURIComponent(req.gatewayPaymentId)}/refund`,
          {
            amount: Number(req.amountPaise),
          },
        ),
      req.transactionId,
      config.timeoutMs,
    );

    const data = body.data ?? {};

    return {
      gatewayRefundId: data.refundReference ?? this.generateId('isw_rfnd'),
      status: 'refunded',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- IGatewayAdapter.void is async; this implementation never awaits
  async void(req: GatewayVoidRequest): Promise<GatewayVoidResponse> {
    this.logger.warn('Void requested but Interswitch void/cancel API is unconfirmed', {
      transactionId: req.transactionId,
      gatewayPaymentId: req.gatewayPaymentId,
    });

    return {
      status: 'failed',
      rawResponse: {
        error: 'Interswitch void/cancel is not implemented — confirm against current docs',
      },
    };
  }

  async fetchStatus(gatewayPaymentId: string, traceId: string): Promise<GatewayStatusResponse> {
    const config = await this.loadConfig();
    const token = await this.getAccessToken(config);
    const http = this.buildHttpClient(config, { Authorization: `Bearer ${token}` });

    const body = await this.request<InterswitchResponse>(
      () =>
        http.get<InterswitchResponse>(`/api/v2/payments/${encodeURIComponent(gatewayPaymentId)}`),
      traceId,
      config.timeoutMs,
    );

    const data = body.data ?? {};
    const statusMap: Record<string, GatewayStatusResponse['status']> = {
      SUCCESSFUL: 'captured',
      FAILED: 'failed',
      PENDING: 'authorised',
      EXPIRED: 'expired',
    };

    return {
      gatewayPaymentId,
      status: (data.status ? statusMap[data.status] : undefined) ?? 'failed',
      amountPaise: data.amount !== undefined ? BigInt(data.amount) : BigInt(0),
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }
}
