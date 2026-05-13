// src/modules/gateways/router/interfaces/routing-result.interface.ts

import { PaymentGateway, PaymentMethod } from '../../../../common/enums';

export interface GatewayScore {
  gateway: PaymentGateway;
  compositeScore: number;
  scoreSuccess: number;
  scoreLatency: number;
  scoreCost: number;
  scoreHealth: number;
  scoreFit: number;
  successRate: number;
  p95LatencyMs: number;
  selectionReason: string;
}

export interface RoutingResult {
  selected: GatewayScore;
  allScores: GatewayScore[];
  paymentMethod: PaymentMethod;
  scoredAt: Date;
}
