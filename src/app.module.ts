// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { GatewaysModule } from './modules/gateways/gateways.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { IdempotencyKeyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { AppController } from './app.controller';

@Module({
  imports: [
    // Config — loads .env and makes ConfigService available everywhere
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    DatabaseModule,
    IdempotencyModule,
    GatewaysModule,
    TransactionsModule,
    WebhooksModule,
    ReconciliationModule,
  ],

  controllers: [AppController],

  providers: [
    // Global exception filter — catches everything
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },

    // Global trace ID interceptor — runs on every request
    {
      provide: APP_INTERCEPTOR,
      useClass: TraceIdInterceptor,
    },

    // Global idempotency key enforcement on POST endpoints
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyKeyInterceptor,
    },

    // Global API key guard — all routes require authentication
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
