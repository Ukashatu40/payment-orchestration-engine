// test/unit/webhooks/webhook-processor.service.spec.ts

import { WebhookProcessorService } from '../../../src/modules/webhooks/webhook-processor.service';
import { PaymentGateway, TransactionState } from '../../../src/common/enums';

const TXN_ID = '0a55277e-f28d-4e78-a05c-13d25e8da58d';

function opayEntry(status: string) {
  return {
    id: 'q1',
    gateway: PaymentGateway.OPAY,
    eventId: `${TXN_ID}:${status}`,
    retryCount: 0,
    payload: {
      type: 'transaction-status',
      payload: { reference: TXN_ID, status, amount: '1000000', currency: 'NGN' },
    },
  } as never;
}

describe('WebhookProcessorService.processOne', () => {
  const markProcessing = jest.fn();
  const markCompleted = jest.fn();
  const markFailed = jest.fn();
  const insertIfNotExists = jest.fn();
  const findById = jest.fn();
  const transition = jest.fn();
  const canTransition = jest.fn();
  const dataSourceTransaction = jest.fn();
  let processor: WebhookProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    dataSourceTransaction.mockImplementation((fn: (m: unknown) => unknown) => fn({}));
    insertIfNotExists.mockResolvedValue(true);
    canTransition.mockImplementation(
      (from: TransactionState, to: TransactionState) =>
        from === TransactionState.AUTH_INITIATED && to === TransactionState.AUTH_EXPIRED,
    );
    processor = new WebhookProcessorService(
      {
        transaction: dataSourceTransaction,
        getRepository: () => ({ update: jest.fn() }),
      } as never,
      {
        markProcessing,
        markCompleted,
        markFailed,
        hashPayload: () => 'hash',
        extractEventType: (_g: unknown, p: { payload: { status: string } }) => p.payload.status,
      } as never,
      { insertIfNotExists, remove: jest.fn() } as never,
      { findById } as never,
      { transition, canTransition } as never,
    );
  });

  it('completes without a dedupe insert when the transaction is unknown (FK would fail)', async () => {
    findById.mockResolvedValue(null);

    await processor.processOne(opayEntry('CLOSE'));

    expect(insertIfNotExists).not.toHaveBeenCalled();
    expect(markCompleted).toHaveBeenCalledWith('q1');
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('expires the payment when Opay reports the order CLOSEd', async () => {
    findById.mockResolvedValue({
      id: TXN_ID,
      traceId: 't',
      state: TransactionState.AUTH_INITIATED,
      amountPaise: '1000000',
      gatewayReference: TXN_ID,
    });

    await processor.processOne(opayEntry('CLOSE'));

    expect(transition).toHaveBeenCalledWith(
      TXN_ID,
      TransactionState.AUTH_EXPIRED,
      expect.objectContaining({ event: 'WEBHOOK_OPAY_CLOSED' }),
    );
    expect(markCompleted).toHaveBeenCalledWith('q1');
  });
});
