// src/modules/idempotency/entities/idempotency-key.entity.ts

import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryColumn,
  Index,
} from 'typeorm';

// No BaseEntity — composite PK, not UUID
@Entity('idempotency_keys')
export class IdempotencyKey {
  // Composite PK enforces merchant-scoped idempotency (FS-13)
  @PrimaryColumn({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  @PrimaryColumn({ name: 'key', type: 'varchar', length: 255 })
  key!: string;

  // SHA-256 of request body — detects payload tampering on replay
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: 'PROCESSING',
  })
  status!: 'PROCESSING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'response_code', type: 'int', nullable: true })
  responseCode!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: Record<string, unknown> | null;

  @Column({
    name: 'transaction_id',
    type: 'uuid',
    nullable: true,
  })
  transactionId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Index()
  @Column({
    name: 'expires_at',
    type: 'timestamptz',
    default: () => "NOW() + INTERVAL '24 hours'",
  })
  expiresAt!: Date;
}
