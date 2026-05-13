// src/modules/gateways/circuit-breaker/circuit-breaker-store.interface.ts

import { CircuitBreakerState } from './circuit-breaker-state.enum';
import { PaymentGateway, PaymentMethod } from '../../../common/enums';

export interface CircuitBreakerEntry {
  gateway: PaymentGateway;
  paymentMethod: PaymentMethod | null; // null = applies to all methods
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureAt: Date | null;
  openedAt: Date | null;
  halfOpenAt: Date | null;
  successCountInHalfOpen: number;
}
