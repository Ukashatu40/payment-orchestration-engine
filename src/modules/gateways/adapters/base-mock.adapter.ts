// src/modules/gateways/adapters/base-mock.adapter.ts

import { Logger } from '@nestjs/common';
import { MockControl, MockResponse } from './mock-control.enum';
import {
  GatewayTimeoutException,
  GatewayUnavailableException,
} from '../../../common/exceptions';
import { PaymentGateway } from '../../../common/enums';

export abstract class BaseMockAdapter {
  protected readonly logger: Logger;

  constructor(adapterName: string) {
    this.logger = new Logger(adapterName);
  }

  // ----------------------------------------------------------------
  // Reads mock control from request metadata.
  // In real usage the test harness passes these as HTTP headers
  // which the webhook/payment controller extracts and forwards
  // through the metadata field on requests.
  // ----------------------------------------------------------------
  protected getMockControl(metadata?: Record<string, unknown>): MockControl {
    return {
      mockResponse: metadata?.['x-mock-response'] as MockResponse,
      mockDelayMs: metadata?.['x-mock-delay-ms'] as number,
      mockGatewayDown: metadata?.['x-mock-gateway-down'] as boolean,
    };
  }

  // ----------------------------------------------------------------
  // Apply delay and check failure conditions.
  // Every mock adapter calls this before returning a response.
  // ----------------------------------------------------------------
  protected async applyMockBehaviour(
    gateway: PaymentGateway,
    transactionId: string,
    control: MockControl,
  ): Promise<void> {
    // Simulate gateway completely unreachable (FS-07)
    if (control.mockGatewayDown) {
      throw new GatewayUnavailableException(
        gateway,
        'Mock gateway marked as down',
      );
    }

    // Simulate configurable latency
    if (control.mockDelayMs && control.mockDelayMs > 0) {
      await this.delay(control.mockDelayMs);
    }

    // Simulate timeout — throws before returning any response (FS-01)
    if (control.mockResponse === MockResponse.TIMEOUT) {
      await this.delay(30_000); // simulate 30s with no response
      throw new GatewayTimeoutException(gateway, 30_000, transactionId);
    }

    // Simulate 5xx server error (FS-04)
    if (control.mockResponse === MockResponse.SERVER_ERROR) {
      throw new GatewayUnavailableException(gateway, 'HTTP 502 Bad Gateway');
    }

    // Rate limit — caller handles 429 with Retry-After (Section A8.4)
    if (control.mockResponse === MockResponse.RATE_LIMIT) {
      throw new GatewayUnavailableException(
        gateway,
        'HTTP 429 Too Many Requests. Retry-After: 5',
      );
    }
  }

  protected generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
