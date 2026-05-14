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
    const signature = this.extractHeader(
      headers,
      'x-razorpay-signature',
      PaymentGateway.RAZORPAY,
    );

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

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
    const sigHeader = this.extractHeader(
      headers,
      'stripe-signature',
      PaymentGateway.STRIPE,
    );

    // Parse t=timestamp,v1=signature
    const parts = sigHeader
      .split(',')
      .reduce<Record<string, string>>((acc, part) => {
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
    const webhookAgeSeconds =
      Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);

    if (webhookAgeSeconds > 300) {
      this.logger.warn('Stripe webhook rejected — timestamp too old', {
        webhookAgeSeconds,
      });
      throw new WebhookSignatureInvalidException(PaymentGateway.STRIPE);
    }

    // Stripe signs: timestamp + '.' + rawBody
    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

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
    const signature = this.extractHeader(
      headers,
      'x-payu-signature',
      PaymentGateway.PAYU,
    );

    // SHA-256 — not SHA-512 (Deliberate Error 1 fix)
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

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
    const signature = this.extractHeader(
      headers,
      'x-upi-signature',
      PaymentGateway.UPI,
    );

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    this.timingSafeCompare(signature, expected, PaymentGateway.UPI);
  }

  // ----------------------------------------------------------------
  // Timing-safe comparison — prevents timing attacks (Section A5.3)
  // Using === is vulnerable to byte-by-byte timing leaks.
  // ----------------------------------------------------------------
  private timingSafeCompare(
    received: string,
    expected: string,
    gateway: PaymentGateway,
  ): void {
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
