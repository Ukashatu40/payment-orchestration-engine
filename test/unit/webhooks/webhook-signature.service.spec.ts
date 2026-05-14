// test/unit/webhooks/webhook-signature.service.spec.ts

import * as crypto from 'crypto';
import { WebhookSignatureService } from '../../../src/modules/webhooks/verification/webhook-signature.service';
import { PaymentGateway } from '../../../src/common/enums';
import { WebhookSignatureInvalidException } from '../../../src/common/exceptions';

const SECRET = 'test-webhook-secret';
const PAYLOAD = JSON.stringify({ event: 'payment.captured', id: 'pay_123' });
const RAW_BODY = Buffer.from(PAYLOAD, 'utf8');

function makeHmac(data: string | Buffer, algo = 'sha256'): string {
  return crypto.createHmac(algo, SECRET).update(data).digest('hex');
}

describe('WebhookSignatureService', () => {
  let service: WebhookSignatureService;

  beforeEach(() => {
    service = new WebhookSignatureService();
  });

  // ----------------------------------------------------------------
  // Razorpay
  // ----------------------------------------------------------------
  describe('Razorpay verification', () => {
    it('should pass with valid signature', () => {
      const sig = makeHmac(RAW_BODY);
      expect(() =>
        service.verify(
          PaymentGateway.RAZORPAY,
          RAW_BODY,
          { 'x-razorpay-signature': sig },
          SECRET,
        ),
      ).not.toThrow();
    });

    it('should throw on invalid signature (FS-10)', () => {
      expect(() =>
        service.verify(
          PaymentGateway.RAZORPAY,
          RAW_BODY,
          { 'x-razorpay-signature': 'invalid-sig' },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should throw on missing header', () => {
      expect(() =>
        service.verify(PaymentGateway.RAZORPAY, RAW_BODY, {}, SECRET),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should throw when payload is tampered (FS-10)', () => {
      const sig = makeHmac(RAW_BODY);
      const tamperedBody = Buffer.from(
        JSON.stringify({ event: 'payment.captured', amount: 10000000 }),
      );
      expect(() =>
        service.verify(
          PaymentGateway.RAZORPAY,
          tamperedBody,
          { 'x-razorpay-signature': sig },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });
  });

  // ----------------------------------------------------------------
  // Stripe
  // ----------------------------------------------------------------
  describe('Stripe verification', () => {
    it('should pass with valid timestamp and signature', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${PAYLOAD}`;
      const sig = makeHmac(signedPayload);
      const sigHeader = `t=${timestamp},v1=${sig}`;

      expect(() =>
        service.verify(
          PaymentGateway.STRIPE,
          RAW_BODY,
          { 'stripe-signature': sigHeader },
          SECRET,
        ),
      ).not.toThrow();
    });

    it('should throw when webhook is older than 5 minutes (FS-10)', () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
      const signedPayload = `${oldTimestamp}.${PAYLOAD}`;
      const sig = makeHmac(signedPayload);
      const sigHeader = `t=${oldTimestamp},v1=${sig}`;

      expect(() =>
        service.verify(
          PaymentGateway.STRIPE,
          RAW_BODY,
          { 'stripe-signature': sigHeader },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should throw on malformed stripe-signature header', () => {
      expect(() =>
        service.verify(
          PaymentGateway.STRIPE,
          RAW_BODY,
          { 'stripe-signature': 'not-valid-format' },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });
  });

  // ----------------------------------------------------------------
  // PayU — SHA-256 (Deliberate Error 1 fix)
  // ----------------------------------------------------------------
  describe('PayU verification', () => {
    it('should pass with SHA-256 signature (not SHA-512)', () => {
      const sig = makeHmac(RAW_BODY, 'sha256');

      expect(() =>
        service.verify(
          PaymentGateway.PAYU,
          RAW_BODY,
          { 'x-payu-signature': sig },
          SECRET,
        ),
      ).not.toThrow();
    });

    it('should reject SHA-512 signature (confirming Error 1 fix)', () => {
      // If the service incorrectly used SHA-512 this would pass — it must fail
      const sha512Sig = makeHmac(RAW_BODY, 'sha512');

      expect(() =>
        service.verify(
          PaymentGateway.PAYU,
          RAW_BODY,
          { 'x-payu-signature': sha512Sig },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });
  });
});
