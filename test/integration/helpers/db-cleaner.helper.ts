// test/integration/helpers/db-cleaner.helper.ts

import { DataSource } from 'typeorm';

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
  // Do NOT truncate gateway_config, routing_config, gateway_health_metrics
  // These are seeded by migrations and must persist across tests
}
