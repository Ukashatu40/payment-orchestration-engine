// src/modules/webhooks/verification/webhook-signature.service.ts

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PaymentGateway } from '../../../common/enums';
import { WebhookSignatureInvalidException } from '../../../common/exceptions';

@Injectable()
export class WebhookSignatureService {
  private readonly logger = new Logger(WebhookSignatureService.name);

  // ----------------------------------------------------------------
  // Main entry point — dispatches to the correct verifier.
  // Throws WebhookSignatureInvalidException on any failure.
  // Satisfies FS-10 (replay attack rejection via HMAC).
  // ----------------------------------------------------------------
  verify(
    gateway: PaymentGateway,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    switch (gateway) {
      case PaymentGateway.RAZORPAY:
        return this.verifyRazorpay(rawBody, headers, secret);
      case PaymentGateway.STRIPE:
        return this.verifyStripe(rawBody, headers, secret);
      case PaymentGateway.PAYU:
        return this.verifyPayU(rawBody, headers, secret);
      case PaymentGateway.UPI:
        return this.verifyUpi(rawBody, headers, secret);
      case PaymentGateway.PAYSTACK:
        return this.verifyPaystack(rawBody, headers, secret);
      case PaymentGateway.FLUTTERWAVE:
        return this.verifyFlutterwave(headers, secret);
      case PaymentGateway.INTERSWITCH:
        return this.verifyInterswitch(rawBody, headers, secret);
      case PaymentGateway.OPAY:
        return this.verifyOpay(rawBody, secret);
    }
  }

  // ----------------------------------------------------------------
  // Razorpay — HMAC-SHA256 (Section A1.3)
  // Header: x-razorpay-signature
  // Input:  raw request body bytes
  //
  // Deliberate Error 5 fix: uses rawBody buffer, NOT JSON.stringify()
  // JSON.stringify() does not guarantee key ordering, which causes
  // valid webhooks to fail verification when key order differs.
  // ----------------------------------------------------------------
  private verifyRazorpay(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const signature = this.extractHeader(headers, 'x-razorpay-signature', PaymentGateway.RAZORPAY);

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    this.timingSafeCompare(signature, expected, PaymentGateway.RAZORPAY);
  }

  // ----------------------------------------------------------------
  // Stripe — HMAC-SHA256 with timestamp prefix (Section A1.3)
  // Header: stripe-signature (format: t=timestamp,v1=signature)
  // Includes replay attack window — rejects webhooks older than 5 min
  // ----------------------------------------------------------------
  private verifyStripe(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const sigHeader = this.extractHeader(headers, 'stripe-signature', PaymentGateway.STRIPE);

    // Parse t=timestamp,v1=signature
    const parts = sigHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});

    const timestamp = parts['t'];
    const v1Sig = parts['v1'];

    if (!timestamp || !v1Sig) {
      this.logger.warn('Malformed Stripe signature header', {
        sigHeader,
      });
      throw new WebhookSignatureInvalidException(PaymentGateway.STRIPE);
    }

    // Replay attack prevention — reject webhooks older than 5 minutes
    // Satisfies FS-10
    const webhookAgeSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);

    if (webhookAgeSeconds > 300) {
      this.logger.warn('Stripe webhook rejected — timestamp too old', {
        webhookAgeSeconds,
      });
      throw new WebhookSignatureInvalidException(PaymentGateway.STRIPE);
    }

    // Stripe signs: timestamp + '.' + rawBody
    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;

    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    this.timingSafeCompare(v1Sig, expected, PaymentGateway.STRIPE);
  }

  // ----------------------------------------------------------------
  // PayU — HMAC-SHA256
  // Deliberate Error 1 fix: PayU uses SHA-256, NOT SHA-512
  // The project spec incorrectly states HMAC-SHA512 for PayU.
  // Header: x-payu-signature
  // ----------------------------------------------------------------
  private verifyPayU(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const signature = this.extractHeader(headers, 'x-payu-signature', PaymentGateway.PAYU);

    // SHA-256 — not SHA-512 (Deliberate Error 1 fix)
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    this.timingSafeCompare(signature, expected, PaymentGateway.PAYU);
  }

  // ----------------------------------------------------------------
  // UPI — digital signature via NPCI cert (Section A1.3)
  // Simplified for mock: treats as HMAC-SHA256
  // Production implementation would verify against NPCI certificate
  // ----------------------------------------------------------------
  private verifyUpi(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const signature = this.extractHeader(headers, 'x-upi-signature', PaymentGateway.UPI);

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    this.timingSafeCompare(signature, expected, PaymentGateway.UPI);
  }

  // ----------------------------------------------------------------
  // Paystack — HMAC-SHA512 (not SHA256 like the other gateways above)
  // Header: x-paystack-signature
  // ----------------------------------------------------------------
  private verifyPaystack(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const signature = this.extractHeader(headers, 'x-paystack-signature', PaymentGateway.PAYSTACK);

    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    this.timingSafeCompare(signature, expected, PaymentGateway.PAYSTACK);
  }

  // ----------------------------------------------------------------
  // Flutterwave — NOT an HMAC. Flutterwave sends back a pre-shared
  // "hash" value (configured in the dashboard, stored as this
  // gateway's webhookSecret) verbatim on every webhook, compared
  // directly against the header — there is no signing of the body.
  // Header: verif-hash
  // ----------------------------------------------------------------
  private verifyFlutterwave(
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const received = this.extractHeader(headers, 'verif-hash', PaymentGateway.FLUTTERWAVE);

    this.timingSafeCompareRaw(received, secret, PaymentGateway.FLUTTERWAVE);
  }

  // ----------------------------------------------------------------
  // Interswitch — HMAC-SHA512 of the raw JSON body, hex-encoded.
  // Header: X-Interswitch-Signature
  // Secret: the merchant-specific key generated in the Quickteller
  // Business dashboard's webhook configuration (stored as this
  // gateway's webhookSecret).
  // Source: https://docs.interswitchgroup.com/v1.1/docs/webhooks
  // ----------------------------------------------------------------
  private verifyInterswitch(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    secret: string,
  ): void {
    const signature = this.extractHeader(
      headers,
      'x-interswitch-signature',
      PaymentGateway.INTERSWITCH,
    );

    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    this.timingSafeCompare(signature, expected, PaymentGateway.INTERSWITCH);
  }

  // ----------------------------------------------------------------
  // Opay — NOT header-based. The signature travels as a top-level
  // `sha512` field in the callback JSON body, computed as
  // HMAC-**SHA3-512** (note: SHA3, not the standard SHA2-512 the other
  // HMAC gateways in this file use) over a specific formatted string
  // built from named fields of the nested `payload` object — not the
  // raw request body.
  //
  // Signing string (fields taken from `body.payload`):
  //   {Amount:"<amount>",Currency:"<currency>",Reference:"<reference>",
  //    Refunded:<t|f>,Status:"<status>",Timestamp:"<timestamp>",
  //    Token:"<token>",TransactionID:"<transactionId>"}
  // `refunded` renders as the bare (unquoted) character t/f.
  //
  // Only the "transaction-status" callback type's signing string is
  // documented; Opay's docs separately reference a "topup" signature
  // method whose exact format isn't confirmed here, so other callback
  // types are rejected rather than assumed to use the same template.
  //
  // Source: https://doc.opaycheckout.com/callback-signature
  // ----------------------------------------------------------------
  private verifyOpay(rawBody: Buffer, secret: string): void {
    let parsed: {
      type?: string;
      sha512?: string;
      payload?: {
        amount?: string;
        currency?: string;
        reference?: string;
        refunded?: boolean;
        status?: string;
        timestamp?: string;
        token?: string;
        transactionId?: string;
      };
    };

    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      this.logger.warn('Opay webhook body is not valid JSON', {
        error: (err as Error).message,
      });
      throw new WebhookSignatureInvalidException(PaymentGateway.OPAY);
    }

    const receivedSignature = parsed.sha512;
    const data = parsed.payload;

    if (!receivedSignature || !data) {
      this.logger.warn('Opay webhook missing sha512 or payload fields');
      throw new WebhookSignatureInvalidException(PaymentGateway.OPAY);
    }

    if (parsed.type !== 'transaction-status') {
      this.logger.error(
        `Opay webhook signature verification for callback type "${parsed.type}" is not ` +
          'implemented — only "transaction-status" is confirmed against current docs',
      );
      throw new WebhookSignatureInvalidException(PaymentGateway.OPAY);
    }

    const refundedFlag = data.refunded ? 't' : 'f';
    const signingString =
      `{Amount:"${data.amount}",Currency:"${data.currency}",Reference:"${data.reference}",` +
      `Refunded:${refundedFlag},Status:"${data.status}",Timestamp:"${data.timestamp}",` +
      `Token:"${data.token}",TransactionID:"${data.transactionId}"}`;

    const expected = crypto.createHmac('sha3-512', secret).update(signingString).digest('hex');

    this.timingSafeCompare(receivedSignature, expected, PaymentGateway.OPAY);
  }

  // ----------------------------------------------------------------
  // Timing-safe comparison — prevents timing attacks (Section A5.3)
  // Using === is vulnerable to byte-by-byte timing leaks.
  // ----------------------------------------------------------------
  private timingSafeCompare(received: string, expected: string, gateway: PaymentGateway): void {
    try {
      const receivedBuf = Buffer.from(received, 'hex');
      const expectedBuf = Buffer.from(expected, 'hex');

      if (
        receivedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(receivedBuf, expectedBuf)
      ) {
        this.logger.warn('Webhook signature mismatch', { gateway });
        throw new WebhookSignatureInvalidException(gateway);
      }
    } catch (err) {
      if (err instanceof WebhookSignatureInvalidException) throw err;

      // Buffer.from() can throw on non-hex input — treat as invalid
      this.logger.warn('Webhook signature parsing failed', {
        gateway,
        error: (err as Error).message,
      });
      throw new WebhookSignatureInvalidException(gateway);
    }
  }

  // ----------------------------------------------------------------
  // Timing-safe comparison for raw (non-hex) shared-secret values,
  // e.g. Flutterwave's verif-hash. crypto.timingSafeEqual requires
  // equal-length buffers, so unequal lengths are treated as a
  // mismatch rather than thrown.
  // ----------------------------------------------------------------
  private timingSafeCompareRaw(received: string, expected: string, gateway: PaymentGateway): void {
    const receivedBuf = Buffer.from(received, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');

    if (
      receivedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(receivedBuf, expectedBuf)
    ) {
      this.logger.warn('Webhook signature mismatch', { gateway });
      throw new WebhookSignatureInvalidException(gateway);
    }
  }

  private extractHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
    gateway: PaymentGateway,
  ): string {
    const value = headers[name];

    if (!value) {
      this.logger.warn(`Missing webhook header: ${name}`, { gateway });
      throw new WebhookSignatureInvalidException(gateway);
    }

    return Array.isArray(value) ? value[0] : value;
  }
}
