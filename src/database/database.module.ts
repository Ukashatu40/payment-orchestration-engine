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
        ],
        migrationsRun: true,
        synchronize: false, // never true in production
        logging:
          config.get('NODE_ENV') === 'development'
            ? ['query', 'error']
            : ['error'],
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
