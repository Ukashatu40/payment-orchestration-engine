// test/unit/webhooks/webhook-queue.service.spec.ts

import { WebhookQueueService } from '../../../src/modules/webhooks/webhook-queue.service';
import { PaymentGateway } from '../../../src/common/enums';

describe('WebhookQueueService.extractEventId', () => {
  const service = new WebhookQueueService({} as never, {} as never);

  const opay = (status: string) => ({
    type: 'transaction-status',
    sha512: 'x',
    payload: { reference: 'txn-1', status },
  });

  it('gives different Opay notifications for one payment different event IDs', () => {
    // Keyed on reference alone, an early PENDING notification would mark the
    // payment processed and the final SUCCESS one would be dropped as a duplicate.
    expect(service.extractEventId(PaymentGateway.OPAY, opay('PENDING'))).not.toBe(
      service.extractEventId(PaymentGateway.OPAY, opay('SUCCESS')),
    );
  });

  it('still dedupes an identical Opay redelivery', () => {
    expect(service.extractEventId(PaymentGateway.OPAY, opay('SUCCESS'))).toBe(
      service.extractEventId(PaymentGateway.OPAY, opay('SUCCESS')),
    );
  });
});
