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
        service.verify(PaymentGateway.RAZORPAY, RAW_BODY, { 'x-razorpay-signature': sig }, SECRET),
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
      expect(() => service.verify(PaymentGateway.RAZORPAY, RAW_BODY, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
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
        service.verify(PaymentGateway.STRIPE, RAW_BODY, { 'stripe-signature': sigHeader }, SECRET),
      ).not.toThrow();
    });

    it('should throw when webhook is older than 5 minutes (FS-10)', () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
      const signedPayload = `${oldTimestamp}.${PAYLOAD}`;
      const sig = makeHmac(signedPayload);
      const sigHeader = `t=${oldTimestamp},v1=${sig}`;

      expect(() =>
        service.verify(PaymentGateway.STRIPE, RAW_BODY, { 'stripe-signature': sigHeader }, SECRET),
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
        service.verify(PaymentGateway.PAYU, RAW_BODY, { 'x-payu-signature': sig }, SECRET),
      ).not.toThrow();
    });

    it('should reject SHA-512 signature (confirming Error 1 fix)', () => {
      // If the service incorrectly used SHA-512 this would pass — it must fail
      const sha512Sig = makeHmac(RAW_BODY, 'sha512');

      expect(() =>
        service.verify(PaymentGateway.PAYU, RAW_BODY, { 'x-payu-signature': sha512Sig }, SECRET),
      ).toThrow(WebhookSignatureInvalidException);
    });
  });

  // ----------------------------------------------------------------
  // Paystack — HMAC-SHA512
  // ----------------------------------------------------------------
  describe('Paystack verification', () => {
    it('should pass with a valid SHA-512 signature', () => {
      const sig = makeHmac(RAW_BODY, 'sha512');
      expect(() =>
        service.verify(PaymentGateway.PAYSTACK, RAW_BODY, { 'x-paystack-signature': sig }, SECRET),
      ).not.toThrow();
    });

    it('should reject a SHA-256 signature (wrong algorithm)', () => {
      const sig = makeHmac(RAW_BODY, 'sha256');
      expect(() =>
        service.verify(PaymentGateway.PAYSTACK, RAW_BODY, { 'x-paystack-signature': sig }, SECRET),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should throw on missing header', () => {
      expect(() => service.verify(PaymentGateway.PAYSTACK, RAW_BODY, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });
  });

  // ----------------------------------------------------------------
  // Flutterwave — direct pre-shared secret comparison via verif-hash,
  // NOT an HMAC over the body.
  // ----------------------------------------------------------------
  describe('Flutterwave verification', () => {
    it('should pass when verif-hash matches the configured secret exactly', () => {
      expect(() =>
        service.verify(PaymentGateway.FLUTTERWAVE, RAW_BODY, { 'verif-hash': SECRET }, SECRET),
      ).not.toThrow();
    });

    it('should reject a mismatched verif-hash', () => {
      expect(() =>
        service.verify(
          PaymentGateway.FLUTTERWAVE,
          RAW_BODY,
          { 'verif-hash': 'wrong-secret' },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should reject an HMAC of the body (confirming it is NOT the scheme used)', () => {
      // If this were mistakenly implemented as an HMAC like the other
      // gateways, hashing the body with the secret would pass — it
      // must not, since Flutterwave sends back the raw shared secret.
      const wouldBeHmac = makeHmac(RAW_BODY, 'sha256');
      expect(() =>
        service.verify(PaymentGateway.FLUTTERWAVE, RAW_BODY, { 'verif-hash': wouldBeHmac }, SECRET),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should throw on missing header', () => {
      expect(() => service.verify(PaymentGateway.FLUTTERWAVE, RAW_BODY, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });
  });

  // ----------------------------------------------------------------
  // Interswitch — HMAC-SHA512 of the raw body, header X-Interswitch-Signature
  // Source: https://docs.interswitchgroup.com/v1.1/docs/webhooks
  // ----------------------------------------------------------------
  describe('Interswitch verification', () => {
    it('should pass with a valid SHA-512 signature', () => {
      const sig = makeHmac(RAW_BODY, 'sha512');
      expect(() =>
        service.verify(
          PaymentGateway.INTERSWITCH,
          RAW_BODY,
          { 'x-interswitch-signature': sig },
          SECRET,
        ),
      ).not.toThrow();
    });

    it('should reject an invalid signature', () => {
      expect(() =>
        service.verify(
          PaymentGateway.INTERSWITCH,
          RAW_BODY,
          { 'x-interswitch-signature': 'deadbeef' },
          SECRET,
        ),
      ).toThrow(WebhookSignatureInvalidException);
    });

    it('should throw on missing header', () => {
      expect(() => service.verify(PaymentGateway.INTERSWITCH, RAW_BODY, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });
  });

  // ----------------------------------------------------------------
  // Opay — signature travels as a body field (`sha512`), computed as
  // HMAC-SHA3-512 over a formatted string built from named fields of
  // the nested `payload` object, not the raw body.
  // Source: https://doc.opaycheckout.com/callback-signature
  // ----------------------------------------------------------------
  describe('Opay verification', () => {
    const opayPayload = {
      amount: '30000',
      currency: 'NGN',
      reference: 'txn-abc-123',
      refunded: false,
      status: 'SUCCESS',
      timestamp: '2026-09-17T11:46:26Z',
      token: '211215140485151728',
      transactionId: '211215140485151728',
    };

    function signingString(p: typeof opayPayload): string {
      const refundedFlag = p.refunded ? 't' : 'f';
      return (
        `{Amount:"${p.amount}",Currency:"${p.currency}",Reference:"${p.reference}",` +
        `Refunded:${refundedFlag},Status:"${p.status}",Timestamp:"${p.timestamp}",` +
        `Token:"${p.token}",TransactionID:"${p.transactionId}"}`
      );
    }

    function makeOpayBody(
      p: typeof opayPayload,
      sha512: string,
      type = 'transaction-status',
    ): Buffer {
      return Buffer.from(JSON.stringify({ payload: p, sha512, type }), 'utf8');
    }

    it('should pass with a valid HMAC-SHA3-512 signature', () => {
      const sig = crypto
        .createHmac('sha3-512', SECRET)
        .update(signingString(opayPayload))
        .digest('hex');
      const body = makeOpayBody(opayPayload, sig);

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).not.toThrow();
    });

    it('should reject a standard HMAC-SHA512 signature (confirming SHA3, not SHA2, is used)', () => {
      const wrongAlgoSig = crypto
        .createHmac('sha512', SECRET)
        .update(signingString(opayPayload))
        .digest('hex');
      const body = makeOpayBody(opayPayload, wrongAlgoSig);

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });

    it('should reject a signature computed over the raw JSON body instead of the formatted signing string', () => {
      const bodyWithoutSig = Buffer.from(
        JSON.stringify({ payload: opayPayload, type: 'transaction-status' }),
        'utf8',
      );
      const wrongSig = crypto.createHmac('sha3-512', SECRET).update(bodyWithoutSig).digest('hex');
      const body = makeOpayBody(opayPayload, wrongSig);

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });

    it('should reject an unrecognized callback type rather than guess its signing format', () => {
      const sig = crypto
        .createHmac('sha3-512', SECRET)
        .update(signingString(opayPayload))
        .digest('hex');
      // 'refund-status' (or any type other than the two confirmed
      // ones) must not be treated as either known signing format.
      const body = makeOpayBody(opayPayload, sig, 'refund-status');

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });

    it('should throw on a body missing the sha512 field', () => {
      const body = Buffer.from(
        JSON.stringify({ payload: opayPayload, type: 'transaction-status' }),
        'utf8',
      );

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });

    it('should throw on a non-JSON body', () => {
      const body = Buffer.from('not-json', 'utf8');

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });
  });

  // ----------------------------------------------------------------
  // Opay — "topup" callback type. Signing-string template confirmed
  // verbatim from https://doc.opaycheckout.com/callback-signature;
  // the JSON envelope (payload wrapper + top-level sha512 field) is
  // inferred by analogy with transaction-status (same page, same
  // payload.getSignature() Java accessor) — not independently shown
  // as a raw example on the docs page. See the code comment above
  // opayTopupSigningString() for the full caveat.
  // ----------------------------------------------------------------
  describe('Opay verification — topup callback type', () => {
    const topupPayload = {
      orderNo: 'OP2409170001',
      merchantOrderNo: 'topup-ref-001',
      merchantId: 'merchant-xxx',
      orderAmount: '50000',
      serviceType: 'WALLET_TOPUP',
      orderStatus: 'SUCCESS',
    };

    function topupSigningString(p: typeof topupPayload): string {
      return (
        `{orderNo:"${p.orderNo}",merchantOrderNo:"${p.merchantOrderNo}",` +
        `merchantId:"${p.merchantId}",orderAmount:"${p.orderAmount}",` +
        `serviceType:"${p.serviceType}",orderStatus:"${p.orderStatus}"}`
      );
    }

    function makeTopupBody(p: typeof topupPayload, sha512: string): Buffer {
      return Buffer.from(JSON.stringify({ payload: p, sha512, type: 'topup' }), 'utf8');
    }

    it('should pass with a valid HMAC-SHA3-512 signature over the topup signing string', () => {
      const sig = crypto
        .createHmac('sha3-512', SECRET)
        .update(topupSigningString(topupPayload))
        .digest('hex');
      const body = makeTopupBody(topupPayload, sig);

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).not.toThrow();
    });

    it('should reject a signature computed with the transaction-status template instead of the topup one', () => {
      // Confirms the two callback types are NOT interchangeable —
      // using the wrong field set/template must fail verification.
      const wrongTemplateSig = crypto
        .createHmac('sha3-512', SECRET)
        .update(
          `{Amount:"${topupPayload.orderAmount}",Currency:"NGN",Reference:"${topupPayload.merchantOrderNo}",` +
            `Refunded:f,Status:"${topupPayload.orderStatus}",Timestamp:"",Token:"",TransactionID:"${topupPayload.orderNo}"}`,
        )
        .digest('hex');
      const body = makeTopupBody(topupPayload, wrongTemplateSig);

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });

    it('should reject a standard HMAC-SHA512 signature (confirming SHA3 is used for topup too)', () => {
      const wrongAlgoSig = crypto
        .createHmac('sha512', SECRET)
        .update(topupSigningString(topupPayload))
        .digest('hex');
      const body = makeTopupBody(topupPayload, wrongAlgoSig);

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });

    it('should reject a mismatched signature', () => {
      const body = makeTopupBody(topupPayload, 'deadbeef');

      expect(() => service.verify(PaymentGateway.OPAY, body, {}, SECRET)).toThrow(
        WebhookSignatureInvalidException,
      );
    });
  });
});
