// scripts/seed-gateway-secrets.ts
//
// Sets a gateway's live credentials in the gateway_config table. This
// is the ONLY supported way to configure gateway secrets — they are
// intentionally NOT read from environment variables (see
// .env.example and README.md "Configuring gateway sandbox
// credentials"), so migrations never carry plaintext keys and rotating
// a secret never requires a redeploy.
//
// Usage:
//   npx ts-node scripts/seed-gateway-secrets.ts \
//     --gateway=PAYSTACK --api-key=sk_test_xxx --webhook-secret=whsec_xxx
//
//   # Gateways needing a second credential (Interswitch's OAuth2
//   # client secret, Opay's HMAC signing key) pass --metadata as JSON,
//   # merged into the existing metadata column rather than replacing it:
//   npx ts-node scripts/seed-gateway-secrets.ts \
//     --gateway=INTERSWITCH --api-key=client-id-xxx \
//     --metadata='{"clientSecret":"client-secret-xxx"}'
//
// Reads DB connection details from process.env (DB_HOST/DB_PORT/
// DB_USER/DB_PASSWORD/DB_NAME), the same variables the app itself
// uses — point this at whichever environment's DB you're seeding by
// exporting those vars or running with `dotenv -e .env.local --`.

import { Client } from 'pg';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gateway = args['gateway'];

  if (!gateway) {
    console.error(
      'Usage: seed-gateway-secrets.ts --gateway=PAYSTACK [--api-key=...] [--webhook-secret=...] [--metadata=\'{"...":"..."}\']',
    );
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'payflow_db',
  });

  await client.connect();

  try {
    const existing = await client.query('SELECT metadata FROM gateway_config WHERE gateway = $1', [
      gateway,
    ]);

    if (existing.rowCount === 0) {
      console.error(`No gateway_config row found for gateway=${gateway}. Run migrations first.`);
      process.exit(1);
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (args['api-key'] !== undefined) {
      updates.push(`api_key = $${paramIndex++}`);
      values.push(args['api-key']);
    }

    if (args['webhook-secret'] !== undefined) {
      updates.push(`webhook_secret = $${paramIndex++}`);
      values.push(args['webhook-secret']);
    }

    if (args['metadata'] !== undefined) {
      const parsed: unknown = JSON.parse(args['metadata']);
      updates.push(`metadata = metadata || $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(parsed));
    }

    if (updates.length === 0) {
      console.error(
        'Nothing to update — pass at least one of --api-key, --webhook-secret, --metadata',
      );
      process.exit(1);
    }

    values.push(gateway);
    await client.query(
      `UPDATE gateway_config SET ${updates.join(', ')}, updated_at = NOW() WHERE gateway = $${paramIndex}`,
      values,
    );

    console.log(`Updated gateway_config for ${gateway}: ${updates.length} field(s) set.`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
