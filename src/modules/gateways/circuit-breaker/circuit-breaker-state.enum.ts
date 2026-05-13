// src/modules/gateways/circuit-breaker/circuit-breaker-state.enum.ts

export enum CircuitBreakerState {
  CLOSED = 'CLOSED', // normal — all requests pass through
  OPEN = 'OPEN', // tripped — all requests fail fast
  HALF_OPEN = 'HALF_OPEN', // testing — single probe request allowed
}
