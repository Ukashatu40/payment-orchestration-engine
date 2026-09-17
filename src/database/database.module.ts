// src/database/database.module.ts

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
// Add these imports at the top
import { CreateTransactions1748000000001 } from './migrations/001-create-transactions';
import { CreateTransactionStateLog1748000000002 } from './migrations/002-create-transaction-state-log';
import { CreateIdempotencyKeys1748000000003 } from './migrations/003-create-idempotency-keys';
import { CreateWebhookTables1748000000004 } from './migrations/004-create-webhook-tables';
import { CreateGatewayRoutes1748000000005 } from './migrations/005-create-gateway-routes';
import { CreateGatewayHealthMetrics1748000000006 } from './migrations/006-create-gateway-health-metrics';
import { CreateReconciliationLog1748000000007 } from './migrations/007-create-reconciliation-log';
import { CreateRefunds1748000000008 } from './migrations/008-create-refunds';
import { CreateGatewayConfig1748000000009 } from './migrations/009-create-gateway-config';
import { CreateRoutingConfigAndSeed1748000000010 } from './migrations/010-create-routing-config-and-seed';
import { AddNgnGatewayEnumValues1748000000011 } from './migrations/011-add-ngn-gateway-enum-values';
import { AddNgnPaymentMethodEnumValues1748000000012 } from './migrations/012-add-ngn-payment-method-enum-values';
import { AddGatewayConfigSupportedCurrencies1748000000013 } from './migrations/013-add-gateway-config-supported-currencies';
import { SeedNgnGatewayConfig1748000000014 } from './migrations/014-seed-ngn-gateway-config';
import { Transaction } from '../modules/transactions/entities/transaction.entity';
import { TransactionStateLog } from '../modules/transactions/entities/transaction-state-log.entity';
import { Refund } from '../modules/transactions/entities/refund.entity';
import { IdempotencyKey } from '../modules/idempotency/entities/idempotency-key.entity';
import { WebhookQueue } from '../modules/webhooks/entities/webhook-queue.entity';
import { ProcessedWebhookEvent } from '../modules/webhooks/entities/processed-webhook-event.entity';
import { GatewayConfig } from '../modules/gateways/entities/gateway-config.entity';
import { GatewayRoute } from '../modules/gateways/entities/gateway-route.entity';
import { GatewayHealthMetrics } from '../modules/gateways/entities/gateway-health-metrics.entity';
import { RoutingConfig } from '../modules/gateways/entities/routing-config.entity';
import { ReconciliationLog } from '../modules/reconciliation/entities/reconciliation-log.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USER', 'postgres'),
        password: config.get('DB_PASSWORD', 'postgres'),
        database: config.get('DB_NAME', 'payflow_db'),
        entities: [
          Transaction,
          TransactionStateLog,
          Refund,
          IdempotencyKey,
          WebhookQueue,
          ProcessedWebhookEvent,
          GatewayConfig,
          GatewayRoute,
          GatewayHealthMetrics,
          RoutingConfig,
          ReconciliationLog,
        ],
        migrations: [
          CreateTransactions1748000000001,
          CreateTransactionStateLog1748000000002,
          CreateIdempotencyKeys1748000000003,
          CreateWebhookTables1748000000004,
          CreateGatewayRoutes1748000000005,
          CreateGatewayHealthMetrics1748000000006,
          CreateReconciliationLog1748000000007,
          CreateRefunds1748000000008,
          CreateGatewayConfig1748000000009,
          CreateRoutingConfigAndSeed1748000000010,
          AddNgnGatewayEnumValues1748000000011,
          AddNgnPaymentMethodEnumValues1748000000012,
          AddGatewayConfigSupportedCurrencies1748000000013,
          SeedNgnGatewayConfig1748000000014,
        ],
        migrationsRun: true,
        // TypeORM's default ('all') wraps every pending migration in a
        // single transaction, which breaks ALTER TYPE ... ADD VALUE
        // migrations (011, 012): Postgres refuses to use a new enum
        // value until the transaction that added it has committed, and
        // 'all' mode never commits until every migration in the batch
        // has run. 'each' commits per migration, so 011 is durable
        // before 014 uses the values it added.
        migrationsTransactionMode: 'each',
        synchronize: false, // never true in production
        logging: config.get('NODE_ENV') === 'development' ? ['query', 'error'] : ['error'],
        extra: {
          // Connection pool settings (FS-14)
          max: config.get<number>('DB_POOL_MAX', 20),
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        },
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
