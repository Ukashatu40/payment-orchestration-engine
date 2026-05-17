// src/database/database.module.ts

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
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
        migrations: ['dist/database/migrations/*.js'],
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
