// src/modules/gateways/entities/gateway-config.entity.ts

import { Entity, Column, PrimaryColumn } from 'typeorm';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';

@Entity('gateway_config')
export class GatewayConfig {
  @PrimaryColumn({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
  })
  gateway!: PaymentGateway;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  // Supported payment methods as array
  @Column({
    name: 'supported_methods',
    type: 'simple-array',
  })
  supportedMethods!: PaymentMethod[];

  // Circuit breaker config — changeable without redeployment (Section A3.3)
  @Column({ name: 'cb_failure_threshold', type: 'int', default: 5 })
  cbFailureThreshold!: number;

  @Column({ name: 'cb_timeout_ms', type: 'int', default: 30000 })
  cbTimeoutMs!: number;

  @Column({ name: 'cb_half_open_requests', type: 'int', default: 1 })
  cbHalfOpenRequests!: number;

  // Cost structure for routing algorithm (Section A3.1)
  @Column({
    name: 'cost_percentage',
    type: 'numeric',
    precision: 5,
    scale: 4,
    default: 0,
  })
  costPercentage!: number; // e.g. 0.02 for 2%

  @Column({
    name: 'cost_fixed_paise',
    type: 'bigint',
    default: 0,
  })
  costFixedPaise!: bigint; // fixed fee per transaction in paise

  // Request timeout per gateway (Section A1.3)
  @Column({ name: 'timeout_ms', type: 'int', default: 30000 })
  timeoutMs!: number;

  // Rate limit (Section A8.4)
  @Column({ name: 'rate_limit_per_sec', type: 'int', default: 100 })
  rateLimitPerSec!: number;

  @Column({ name: 'api_key', type: 'varchar', length: 500, nullable: true })
  apiKey!: string | null;

  @Column({
    name: 'webhook_secret',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  webhookSecret!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;
}
