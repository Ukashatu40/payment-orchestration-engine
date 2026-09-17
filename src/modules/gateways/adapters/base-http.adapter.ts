// src/modules/gateways/adapters/base-http.adapter.ts

import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { GatewayConfigRepository } from '../repositories/gateway-config.repository';
import { GatewayConfig } from '../entities/gateway-config.entity';
import { GatewayTimeoutException, GatewayUnavailableException } from '../../../common/exceptions';
import { PaymentGateway } from '../../../common/enums';

// ----------------------------------------------------------------
// Sibling of BaseMockAdapter, not a subclass — the mock adapters
// (Razorpay/Stripe/PayU/UPI) simulate responses in-process and never
// touch the network. Adapters extending this class make real HTTP
// calls to sandbox/production gateway APIs (Paystack, Flutterwave,
// Interswitch, Opay).
//
// A charge decline is typically an HTTP 200 with a failed/declined
// status in the response body, not an HTTP error — subclasses must
// inspect the parsed body themselves; request() below only maps
// transport/infra failures (timeouts, 5xx, network errors) to the
// existing GatewayTimeoutException/GatewayUnavailableException so the
// circuit breaker and GlobalExceptionFilter keep working unmodified.
// ----------------------------------------------------------------
export abstract class BaseHttpAdapter {
  protected readonly logger: Logger;

  constructor(
    adapterName: string,
    protected readonly gateway: PaymentGateway,
    protected readonly gatewayConfigRepo: GatewayConfigRepository,
  ) {
    this.logger = new Logger(adapterName);
  }

  // Fetches the current gateway_config row fresh on every call.
  // apiKey/timeoutMs/metadata are DB-mutable at runtime (via the
  // gateway config update endpoint), so caching them once at
  // construction would risk using a stale secret or timeout.
  protected async loadConfig(): Promise<GatewayConfig> {
    const config = await this.gatewayConfigRepo.findByGateway(this.gateway);

    if (!config) {
      throw new GatewayUnavailableException(this.gateway, 'No gateway_config row configured');
    }

    return config;
  }

  protected buildHttpClient(config: GatewayConfig, headers: Record<string, string>): AxiosInstance {
    const baseURL = (config.metadata?.['baseUrl'] as string) ?? '';

    return axios.create({
      baseURL,
      timeout: config.timeoutMs,
      headers,
    });
  }

  // Wraps a single outbound call — no automatic retry. Retrying a
  // mutating charge/refund call risks duplicating it at the gateway;
  // resilience is handled one layer up by the existing circuit
  // breaker + router failover, exactly as it already is for the mock
  // adapters.
  protected async request<T>(
    fn: () => Promise<AxiosResponse<T>>,
    transactionId: string,
    timeoutMs: number,
  ): Promise<T> {
    try {
      const res = await fn();
      return res.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          throw new GatewayTimeoutException(this.gateway, timeoutMs, transactionId);
        }

        if (!err.response || err.response.status >= 500 || err.response.status === 429) {
          throw new GatewayUnavailableException(
            this.gateway,
            `HTTP ${err.response?.status ?? 'network error'}: ${err.message}`,
          );
        }
      }

      throw err;
    }
  }

  protected generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
