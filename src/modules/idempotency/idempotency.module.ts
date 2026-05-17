// src/modules/idempotency/idempotency.module.ts

import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKeyRepository } from './repositories/idempotency-key.repository';

@Module({
  providers: [IdempotencyService, IdempotencyKeyRepository],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
