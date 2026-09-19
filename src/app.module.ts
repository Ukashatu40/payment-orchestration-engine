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
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AuthGuard } from './modules/auth/guards/auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { CsrfGuard } from './modules/auth/guards/csrf.guard';
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
    UsersModule,
    AuthModule,
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

    // Global auth guard — accepts a user session (cookie/JWT) or a
    // legacy API key. Runs before RolesGuard, which needs the
    // request.user it populates. Registration order matters here —
    // multiple APP_GUARD providers run in the order they're listed.
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
