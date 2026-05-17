// src/modules/gateways/entities/routing-config.entity.ts

import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Stores the routing algorithm weights — changeable without redeployment
// Section A3.1 — weights must be DB-stored, not hardcoded
@Entity('routing_config')
export class RoutingConfig {
  @PrimaryColumn({ name: 'config_key', type: 'varchar', length: 100 })
  configKey!: string;

  // Routing weights — must sum to 1.0 (validated at service layer)
  @Column({
    name: 'weight_success_rate',
    type: 'numeric',
    precision: 4,
    scale: 3,
    default: 0.35,
  })
  weightSuccessRate!: number;

  @Column({
    name: 'weight_latency',
    type: 'numeric',
    precision: 4,
    scale: 3,
    default: 0.2,
  })
  weightLatency!: number;

  @Column({
    name: 'weight_cost',
    type: 'numeric',
    precision: 4,
    scale: 3,
    default: 0.2,
  })
  weightCost!: number;

  @Column({
    name: 'weight_health',
    type: 'numeric',
    precision: 4,
    scale: 3,
    default: 0.15,
  })
  weightHealth!: number;

  @Column({
    name: 'weight_fit',
    type: 'numeric',
    precision: 4,
    scale: 3,
    default: 0.1,
  })
  weightFit!: number;

  // Sliding window in minutes for success rate / latency calc
  @Column({ name: 'sliding_window_minutes', type: 'int', default: 10 })
  slidingWindowMinutes!: number;

  // If degraded gateway scores within this % of next-best, skip it
  @Column({
    name: 'degraded_skip_threshold',
    type: 'numeric',
    precision: 4,
    scale: 3,
    default: 0.2,
  })
  degradedSkipThreshold!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
