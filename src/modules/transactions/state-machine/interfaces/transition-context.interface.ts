// src/modules/transactions/state-machine/interfaces/transition-context.interface.ts

export interface TransitionContext {
  // What event caused this transition
  // e.g. 'GATEWAY_AUTH_SUCCESS', 'WEBHOOK_RECEIVED', 'RECONCILIATION_OVERRIDE'
  event: string;

  // What component triggered this transition
  // e.g. 'api_server', 'webhook_processor', 'reconciliation_engine'
  triggeredBy: string;

  // Propagated from the original payment request (Section A8.5)
  traceId: string;

  // Gateway's own reference ID for this transaction
  gatewayReference?: string;

  // Full gateway response — PII will be redacted before storage
  gatewayResponse?: Record<string, unknown>;

  // Any additional context to store in the audit log
  metadata?: Record<string, unknown>;
}
