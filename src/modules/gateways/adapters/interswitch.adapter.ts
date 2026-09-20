// src/modules/gateways/adapters/interswitch.adapter.ts

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
import { GatewayConfig } from '../entities/gateway-config.entity';
import { GatewayUnavailableException } from '../../../common/exceptions';

interface InterswitchTransactionResponse {
  ResponseCode?: string;
  ResponseDescription?: string;
  Amount?: number | string;
  MerchantReference?: string;
  PaymentReference?: string;
}

export interface InterswitchCheckoutForm {
  action: string;
  fields: Record<string, string>;
}

// ISO 4217 numeric codes Interswitch expects in the `currency` field.
const CURRENCY_CODES: Record<string, string> = { NGN: '566', USD: '840' };

// ----------------------------------------------------------------
// Interswitch Web Checkout (https://docs.interswitchgroup.com/docs/web-checkout)
// has NO server-side "create payment" call: the payer's browser must
// POST a form (merchant_code, pay_item_id, txn_ref, amount, currency,
// site_redirect_url, ...) to Interswitch's hosted page. So authorise()
// makes no network call — it returns a checkoutUrl pointing at this
// backend's own /api/v1/checkout/interswitch/:transactionId page, which
// loads the transaction and auto-submits that form (see
// checkout.controller.ts). Our transactionId IS the txn_ref, so both the
// redirect callback and the TRANSACTION.COMPLETED webhook
// (data.merchantReference) resolve straight back to it.
//
// Config (gateway_config.metadata): merchantCode, payItemId, baseUrl
// (https://sandbox.interswitchng.com), publicBaseUrl (this backend's
// public origin; falls back to PUBLIC_BASE_URL / RENDER_EXTERNAL_URL),
// returnUrl (page the payer lands on, may use {transactionId}).
// Webhook signature secret lives in gateway_config.webhook_secret.
//
// Status is verified server-side with GET
// /collections/api/v1/gettransaction.json (ResponseCode "00" = approved).
// The refund/void APIs are not documented for this product, so they are
// reported as unsupported rather than guessed at.
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

  constructor(gatewayConfigRepo: GatewayConfigRepository) {
    super(InterswitchAdapter.name, PaymentGateway.INTERSWITCH, gatewayConfigRepo);
  }

  private requireMetadata(config: GatewayConfig, key: string): string {
    const value = config.metadata?.[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new GatewayUnavailableException(
        this.gateway,
        `Interswitch gateway_config.metadata.${key} is not set — seed it with scripts/seed-gateway-secrets.ts`,
      );
    }
    return value;
  }

  publicBaseUrl(config: GatewayConfig): string {
    const fromConfig = config.metadata?.['publicBaseUrl'];
    const value =
      (typeof fromConfig === 'string' && fromConfig) ||
      process.env.PUBLIC_BASE_URL ||
      process.env.RENDER_EXTERNAL_URL;
    if (!value) {
      throw new GatewayUnavailableException(
        this.gateway,
        "Interswitch needs this backend's public URL — set gateway_config.metadata.publicBaseUrl or PUBLIC_BASE_URL",
      );
    }
    return value.replace(/\/+$/, '');
  }

  // The fields the payer's browser posts to Interswitch's hosted page.
  buildCheckoutForm(
    config: GatewayConfig,
    p: { transactionId: string; amountPaise: bigint; currency: string; email?: string },
  ): InterswitchCheckoutForm {
    const currencyCode = CURRENCY_CODES[p.currency];
    if (!currencyCode) {
      throw new GatewayUnavailableException(
        this.gateway,
        `Interswitch checkout does not support currency ${p.currency}`,
      );
    }
    const baseURL = this.requireMetadata(config, 'baseUrl').replace(/\/+$/, '');

    return {
      action: `${baseURL}/collections/w/pay`,
      fields: {
        merchant_code: this.requireMetadata(config, 'merchantCode'),
        pay_item_id: this.requireMetadata(config, 'payItemId'),
        txn_ref: p.transactionId,
        amount: p.amountPaise.toString(),
        currency: currencyCode,
        site_redirect_url: `${this.publicBaseUrl(config)}/api/v1/checkout/interswitch/return/${p.transactionId}`,
        ...(p.email && { cust_email: p.email }),
      },
    };
  }

  async authorise(req: GatewayAuthRequest): Promise<GatewayAuthResponse> {
    const config = await this.loadConfig();
    // Fail fast on missing config so the payment errors here rather than
    // handing the payer a checkout link that cannot work.
    this.requireMetadata(config, 'merchantCode');
    this.requireMetadata(config, 'payItemId');

    const query = req.customerEmail ? `?email=${encodeURIComponent(req.customerEmail)}` : '';

    return {
      gatewayPaymentId: req.transactionId,
      gatewayReference: req.transactionId,
      status: 'pending',
      checkoutUrl: `${this.publicBaseUrl(config)}/api/v1/checkout/interswitch/${req.transactionId}${query}`,
      rawResponse: { flow: 'web_checkout_redirect' },
    };
  }

  private async queryTransaction(
    config: GatewayConfig,
    txnRef: string,
    amountPaise: bigint,
    traceId: string,
  ): Promise<InterswitchTransactionResponse> {
    const http = this.buildHttpClient(config, { 'Content-Type': 'application/json' });

    return this.request<InterswitchTransactionResponse>(
      () =>
        http.get<InterswitchTransactionResponse>('/collections/api/v1/gettransaction.json', {
          params: {
            merchantcode: this.requireMetadata(config, 'merchantCode'),
            transactionreference: txnRef,
            amount: amountPaise.toString(),
          },
        }),
      traceId,
      config.timeoutMs,
    );
  }

  async capture(req: GatewayCaptureRequest): Promise<GatewayCaptureResponse> {
    const config = await this.loadConfig();
    const body = await this.queryTransaction(
      config,
      req.gatewayPaymentId,
      req.amountPaise,
      req.transactionId,
    );
    const captured = body.ResponseCode === '00';

    return {
      gatewayReference: req.gatewayPaymentId,
      capturedAmountPaise: captured ? req.amountPaise : BigInt(0),
      status: captured ? 'captured' : 'failed',
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- unsupported operation, no network call
  async refund(req: GatewayRefundRequest): Promise<GatewayRefundResponse> {
    this.logger.warn('Refund requested but no Interswitch Web Checkout refund API is confirmed', {
      transactionId: req.transactionId,
    });

    return {
      gatewayRefundId: this.generateId('isw_rfnd'),
      status: 'failed',
      rawResponse: {
        error:
          'Interswitch refunds are not implemented — process them in the Interswitch dashboard',
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- unsupported operation, no network call
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

  async fetchStatus(
    gatewayPaymentId: string,
    traceId: string,
    amountPaise: bigint = BigInt(0),
  ): Promise<GatewayStatusResponse> {
    const config = await this.loadConfig();
    const body = await this.queryTransaction(config, gatewayPaymentId, amountPaise, traceId);

    // 00 approved. 09 (in progress) and Z25 ("Transaction not Found" — the
    // payer has not completed checkout yet) are still pending, NOT failures.
    // Anything else (Z6 cancelled, 51, ...) is a failure.
    const pendingCodes = ['09', 'Z25'];
    const status: GatewayStatusResponse['status'] =
      body.ResponseCode === '00'
        ? 'captured'
        : pendingCodes.includes(body.ResponseCode ?? '')
          ? 'authorised'
          : 'failed';

    return {
      gatewayPaymentId,
      status,
      amountPaise: body.Amount !== undefined ? BigInt(body.Amount) : BigInt(0),
      rawResponse: body as unknown as Record<string, unknown>,
    };
  }
}
