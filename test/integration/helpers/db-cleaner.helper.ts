// test/integration/helpers/db-cleaner.helper.ts

import { DataSource } from 'typeorm';

export async function cleanDatabase(dataSource: DataSource): Promise<void> {
  // TRUNCATE ... CASCADE is irreversible. Refuse to run against anything that
  // is not obviously a throwaway test database, whatever the env resolved to.
  const rows: Array<{ db: string }> = await dataSource.query('SELECT current_database() AS db');
  const db = rows[0]?.db ?? '';
  if (!/test/i.test(db)) {
    throw new Error(
      `Refusing to truncate tables: connected database "${db}" is not a test database`,
    );
  }

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
