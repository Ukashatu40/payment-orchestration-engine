// test/unit/checkout/checkout.controller.spec.ts

import { CheckoutController } from '../../../src/modules/checkout/checkout.controller';
import { InterswitchAdapter } from '../../../src/modules/gateways/adapters/interswitch.adapter';
import { PaymentGateway, TransactionState } from '../../../src/common/enums';

const TXN_ID = '6f1b0f0e-8f8f-4f3e-9c55-0d8e5a1b2c3d';

function makeReply() {
  const reply = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header(k: string, v: string) {
      reply.headers[k] = v;
      return reply;
    },
    send(b?: unknown) {
      reply.body = b;
      return reply;
    },
  };
  return reply;
}

describe('CheckoutController', () => {
  const findById = jest.fn();
  const findByGateway = jest.fn();
  const buildCheckoutForm = jest.fn();
  const fetchStatus = jest.fn();
  const advanceTransaction = jest.fn();
  let controller: CheckoutController;

  beforeEach(() => {
    jest.clearAllMocks();
    buildCheckoutForm.mockReturnValue({
      action: 'https://sandbox.interswitchng.com/collections/w/pay',
      fields: { txn_ref: TXN_ID, cust_email: '"><script>x</script>' },
    });
    findByGateway.mockResolvedValue({
      metadata: { returnUrl: 'https://portal.example.com/transactions/{transactionId}' },
    });
    controller = new CheckoutController(
      { findById } as never,
      { findByGateway } as never,
      { buildCheckoutForm, fetchStatus } as unknown as InterswitchAdapter,
      { advanceTransaction } as never,
    );
    controller.verifyRetryDelayMs = 0;
  });

  it('renders an auto-submitting form with escaped values', async () => {
    findById.mockResolvedValue({
      id: TXN_ID,
      gateway: PaymentGateway.INTERSWITCH,
      state: TransactionState.AUTH_INITIATED,
      amountPaise: '500000',
      currency: 'NGN',
    });
    const reply = makeReply();

    await controller.checkoutPage(TXN_ID, 'a@b.com', reply as never);

    const html = reply.body as string;
    expect(reply.statusCode).toBe(200);
    expect(html).toContain('action="https://sandbox.interswitchng.com/collections/w/pay"');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).not.toContain('"><script>');
    expect(buildCheckoutForm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountPaise: BigInt(500000), email: 'a@b.com' }),
    );
  });

  it('drops a malformed email instead of passing it through', async () => {
    findById.mockResolvedValue({
      id: TXN_ID,
      gateway: PaymentGateway.INTERSWITCH,
      state: TransactionState.AUTH_INITIATED,
      amountPaise: '1',
      currency: 'NGN',
    });

    await controller.checkoutPage(TXN_ID, '"><x', makeReply() as never);

    expect(buildCheckoutForm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: undefined }),
    );
  });

  it('404s for a transaction on another gateway', async () => {
    findById.mockResolvedValue({ id: TXN_ID, gateway: PaymentGateway.PAYSTACK });
    const reply = makeReply();

    await controller.checkoutPage(TXN_ID, undefined, reply as never);

    expect(reply.statusCode).toBe(404);
  });

  it('409s once the payment is no longer awaiting the payer', async () => {
    findById.mockResolvedValue({
      id: TXN_ID,
      gateway: PaymentGateway.INTERSWITCH,
      state: TransactionState.CAPTURED,
    });
    const reply = makeReply();

    await controller.checkoutPage(TXN_ID, undefined, reply as never);

    expect(reply.statusCode).toBe(409);
  });

  it('redirects the returning browser to the configured returnUrl', async () => {
    const reply = makeReply();

    await controller.returnFromInterswitch({ txnref: TXN_ID, resp: '00' }, reply as never);

    expect(reply.statusCode).toBe(303);
    expect(reply.headers['Location']).toBe(`https://portal.example.com/transactions/${TXN_ID}`);
  });

  it.each([['txnRef'], ['TXNREF'], ['txn_ref'], ['transactionreference']])(
    'finds the transaction reference posted as "%s"',
    async (key) => {
      const reply = makeReply();

      await controller.returnFromInterswitch({ [key]: TXN_ID }, reply as never);

      expect(reply.statusCode).toBe(303);
      expect(reply.headers['Location']).toContain(TXN_ID);
    },
  );

  it('also accepts the reference in the query string', async () => {
    const reply = makeReply();

    await controller.returnFromInterswitch({}, reply as never, { txnref: TXN_ID });

    expect(reply.statusCode).toBe(303);
  });

  it('ignores a non-UUID txnref rather than redirecting', async () => {
    const reply = makeReply();

    await controller.returnFromInterswitch({ txnref: '../../evil' }, reply as never);

    expect(reply.statusCode).toBe(200);
    expect(reply.headers['Location']).toBeUndefined();
  });

  describe('return verification', () => {
    const txn = {
      id: TXN_ID,
      traceId: 'trace-1',
      gateway: PaymentGateway.INTERSWITCH,
      state: TransactionState.AUTH_INITIATED,
      amountPaise: '300000',
    };

    it('captures the payment when Interswitch approves the matching amount', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockResolvedValue({
        status: 'captured',
        amountPaise: BigInt(300000),
        rawResponse: { ResponseCode: '00' },
      });

      await controller.returnFromInterswitch({ txnref: TXN_ID }, makeReply() as never);

      expect(fetchStatus).toHaveBeenCalledWith(TXN_ID, 'trace-1', BigInt(300000));
      expect(advanceTransaction).toHaveBeenCalledWith(
        txn,
        TransactionState.CAPTURED,
        expect.objectContaining({ event: 'INTERSWITCH_RETURN_VERIFIED' }),
      );
    });

    it('does not capture when Interswitch approved a different amount', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockResolvedValue({
        status: 'captured',
        amountPaise: BigInt(1),
        rawResponse: {},
      });

      await controller.returnFromInterswitch({ txnref: TXN_ID }, makeReply() as never);

      expect(advanceTransaction).not.toHaveBeenCalled();
    });

    it('does not capture a pending or failed result', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockResolvedValue({
        status: 'authorised',
        amountPaise: BigInt(0),
        rawResponse: {},
      });

      await controller.returnFromInterswitch({ txnref: TXN_ID }, makeReply() as never);

      expect(advanceTransaction).not.toHaveBeenCalled();
    });

    it('never trusts the browser: a forged resp=00 without gateway approval changes nothing', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockResolvedValue({ status: 'failed', amountPaise: BigInt(0), rawResponse: {} });

      await controller.returnFromInterswitch(
        { txnref: TXN_ID, resp: '00', amount: '300000' },
        makeReply() as never,
      );

      expect(advanceTransaction).not.toHaveBeenCalled();
    });

    it('still redirects the payer when verification throws', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockRejectedValue(new Error('gateway down'));
      const reply = makeReply();

      await controller.returnFromInterswitch({ txnref: TXN_ID }, reply as never);

      expect(reply.statusCode).toBe(303);
    });

    it('skips verification for a payment that is no longer awaiting the payer', async () => {
      findById.mockResolvedValue({ ...txn, state: TransactionState.CAPTURED });

      await controller.returnFromInterswitch({ txnref: TXN_ID }, makeReply() as never);

      expect(fetchStatus).not.toHaveBeenCalled();
    });
  });

  describe('path-based return (/return/:id)', () => {
    const txn = {
      id: TXN_ID,
      traceId: 'trace-1',
      gateway: PaymentGateway.INTERSWITCH,
      state: TransactionState.AUTH_INITIATED,
      amountPaise: '300000',
    };

    it('uses the transaction ID from the URL even when Interswitch echoes a blank txnref', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockResolvedValue({
        status: 'captured',
        amountPaise: BigInt(300000),
        rawResponse: {},
      });
      const reply = makeReply();

      await controller.returnForTransaction(TXN_ID, { txnref: '' }, reply as never);

      expect(fetchStatus).toHaveBeenCalledWith(TXN_ID, 'trace-1', BigInt(300000));
      expect(advanceTransaction).toHaveBeenCalled();
      expect(reply.statusCode).toBe(303);
      expect(reply.headers['Location']).toContain(TXN_ID);
    });
  });

  describe('checkout page self-healing', () => {
    it('redirects to the portal instead of re-showing the form when the payment already went through', async () => {
      const awaiting = {
        id: TXN_ID,
        traceId: 't',
        gateway: PaymentGateway.INTERSWITCH,
        state: TransactionState.AUTH_INITIATED,
        amountPaise: '300000',
      };
      findById
        .mockResolvedValueOnce({ ...awaiting }) // page load
        .mockResolvedValueOnce({ ...awaiting }) // verifyAndAdvance
        .mockResolvedValueOnce({ ...awaiting, state: TransactionState.CAPTURED }); // refreshed
      fetchStatus.mockResolvedValue({
        status: 'captured',
        amountPaise: BigInt(300000),
        rawResponse: {},
      });
      const reply = makeReply();

      await controller.checkoutPage(TXN_ID, undefined, reply as never);

      expect(reply.statusCode).toBe(303);
      expect(buildCheckoutForm).not.toHaveBeenCalled();
    });
  });

  describe('verification retries', () => {
    const txn = {
      id: TXN_ID,
      traceId: 'trace-1',
      gateway: PaymentGateway.INTERSWITCH,
      state: TransactionState.AUTH_INITIATED,
      amountPaise: '300000',
    };

    it('retries a not-yet-visible payment and captures once Interswitch reports it', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus
        .mockResolvedValueOnce({ status: 'authorised', amountPaise: BigInt(0), rawResponse: {} })
        .mockResolvedValueOnce({
          status: 'captured',
          amountPaise: BigInt(300000),
          rawResponse: { ResponseCode: '00' },
        });

      await controller.returnForTransaction(TXN_ID, {}, makeReply() as never);

      expect(fetchStatus).toHaveBeenCalledTimes(2);
      expect(advanceTransaction).toHaveBeenCalled();
    });

    it('gives up after 3 attempts if it is never reported', async () => {
      findById.mockResolvedValue(txn);
      fetchStatus.mockResolvedValue({
        status: 'authorised',
        amountPaise: BigInt(0),
        rawResponse: {},
      });

      await controller.returnForTransaction(TXN_ID, {}, makeReply() as never);

      expect(fetchStatus).toHaveBeenCalledTimes(3);
      expect(advanceTransaction).not.toHaveBeenCalled();
    });
  });
});
