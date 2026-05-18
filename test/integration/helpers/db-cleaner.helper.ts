// test/integration/helpers/db-cleaner.helper.ts

import { DataSource } from 'typeorm';

// Truncates all tables between tests — order matters due to FK constraints
export async function cleanDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    TRUNCATE TABLE
      reconciliation_log,
      processed_webhook_events,
      webhook_queue,
      gateway_routes,
      transaction_state_log,
      refunds,
      idempotency_keys,
      transactions
    RESTART IDENTITY CASCADE
  `);
}
