// src/modules/gateways/entities/gateway-health-metrics.entity.ts

import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';

// Per-minute aggregates — written by the metrics collector,
// read by the routing algorithm's sliding window query
@Entity('gateway_health_metrics')
@Index(['gateway', 'paymentMethod', 'recordedAt'])
export class GatewayHealthMetrics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'gateway',
    type: 'enum',
    enum: PaymentGateway,
  })
  gateway: PaymentGateway;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    nullable: true,
  })
  paymentMethod: PaymentMethod | null;

  @Column({ name: 'success_count', type: 'int', default: 0 })
  successCount: number;

  @Column({ name: 'total_count', type: 'int', default: 0 })
  totalCount: number;

  // P95 latency in milliseconds for auth requests
  @Column({ name: 'p95_latency_ms', type: 'int', nullable: true })
  p95LatencyMs: number | null;

  @Column({ name: 'avg_latency_ms', type: 'int', nullable: true })
  avgLatencyMs: number | null;

  @Index()
  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}
