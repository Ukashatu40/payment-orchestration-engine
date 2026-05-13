// src/modules/webhooks/verification/webhook-signature.service.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { FastifyRequest } from 'fastify';

@Injectable()
export class WebhookSignatureService {
  verifyRazorpay(request: FastifyRequest, secret: string): void {
    const signature = request.headers['x-razorpay-signature'] as string;

    if (!signature) {
      throw new UnauthorizedException('Missing Razorpay signature header');
    }

    // Use rawBody buffer — not JSON.stringify(request.body)
    // This is the correct fix for Deliberate Error 5
    const rawBody = (request as any).rawBody as Buffer;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody) // ← raw bytes, key-order safe
      .digest('hex');

    // Timing-safe comparison (Section A5.3)
    const sigBuffer = Buffer.from(signature, 'hex');
    const expBuffer = Buffer.from(expected, 'hex');

    if (
      sigBuffer.length !== expBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expBuffer)
    ) {
      throw new UnauthorizedException('Invalid Razorpay webhook signature');
    }
  }

  verifyStripe(request: FastifyRequest, secret: string): void {
    const signature = request.headers['stripe-signature'] as string;
    const rawBody = (request as any).rawBody as Buffer;

    // Stripe uses a timestamp-based signature to prevent replay attacks
    // Format: t=timestamp,v1=signature
    const elements = signature.split(',');
    const timestamp = elements.find((e) => e.startsWith('t='))?.split('=')[1];
    const v1Sig = elements.find((e) => e.startsWith('v1='))?.split('=')[1];

    if (!timestamp || !v1Sig) {
      throw new UnauthorizedException('Malformed Stripe signature header');
    }

    // Reject webhooks older than 5 minutes (replay attack prevention FS-10)
    const webhookAge = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (webhookAge > 300) {
      throw new UnauthorizedException('Stripe webhook timestamp too old');
    }

    const payload = `${timestamp}.${rawBody.toString('utf8')}`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    if (
      !crypto.timingSafeEqual(
        Buffer.from(v1Sig, 'hex'),
        Buffer.from(expected, 'hex'),
      )
    ) {
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }
  }

  verifyPayU(request: FastifyRequest, secret: string): void {
    // Deliberate Error 1 correction: PayU uses SHA-256, NOT SHA-512
    const signature = request.headers['x-payu-signature'] as string;
    const rawBody = (request as any).rawBody as Buffer;

    const expected = crypto
      .createHmac('sha256', secret) // ← SHA-256, not SHA-512
      .update(rawBody)
      .digest('hex');

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex'),
      )
    ) {
      throw new UnauthorizedException('Invalid PayU webhook signature');
    }
  }
}
