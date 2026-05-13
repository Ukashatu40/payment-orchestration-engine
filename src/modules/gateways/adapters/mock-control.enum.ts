// src/modules/gateways/adapters/mock-control.enum.ts

export enum MockResponse {
  SUCCESS = 'success',
  TIMEOUT = 'timeout',
  SERVER_ERROR = 'server-error',
  DECLINE = 'decline',
  RATE_LIMIT = 'rate-limit',
}

export interface MockControl {
  mockResponse?: MockResponse;
  mockDelayMs?: number;
  mockGatewayDown?: boolean;
}
