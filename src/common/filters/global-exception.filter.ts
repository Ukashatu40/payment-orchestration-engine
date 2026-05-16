// src/common/filters/global-exception.filter.ts

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { InvalidStateTransitionException } from '../exceptions/invalid-state-transition.exception';
import { IdempotencyConflictException } from '../exceptions/idempotency-conflict.exception';
import { WebhookSignatureInvalidException } from '../exceptions/webhook-signature-invalid.exception';
import { GatewayTimeoutException } from '../exceptions/gateway-timeout.exception';
import { GatewayUnavailableException } from '../exceptions/gateway-unavailable.exception';
import { NoGatewayAvailableException } from '../exceptions/no-gateway-available.exception';

// Standard error response shape (Section A7.2)
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
    timestamp: string;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const traceId = (request as any).traceId ?? 'unknown';

    const { statusCode, code, message, details } = this.classify(exception);

    const body: ErrorResponse = {
      error: {
        code,
        message,
        details,
        request_id: traceId,
        timestamp: new Date().toISOString(),
      },
    };

    // Log 5xx errors — 4xx are expected and logged at warn
    if (statusCode >= 500) {
      this.logger.error('Unhandled exception', {
        exception: (exception as Error).message,
        stack: (exception as Error).stack,
        url: request.url,
        method: request.method,
        traceId,
      });
    } else {
      this.logger.warn('Client error', {
        code,
        message,
        url: request.url,
        method: request.method,
        traceId,
      });
    }

    reply.status(statusCode).send(body);
  }

  // ----------------------------------------------------------------
  // Maps every exception type to HTTP status + error code.
  // Domain exceptions are translated here — never leaked raw.
  // ----------------------------------------------------------------
  private classify(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    // NestJS HTTP exceptions (NotFoundException, BadRequestException, etc.)
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as any).message ?? exception.message);

      return {
        statusCode: exception.getStatus(),
        code: this.httpStatusToCode(exception.getStatus()),
        message: Array.isArray(message) ? message.join(', ') : message,
      };
    }

    // Domain exceptions
    if (exception instanceof InvalidStateTransitionException) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'INVALID_STATE_TRANSITION',
        message: exception.message,
        details: {
          fromState: exception.fromState,
          toState: exception.toState,
          validTargets: exception.validTargets,
        },
      };
    }

    if (exception instanceof IdempotencyConflictException) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'A request with this idempotency key is already in progress',
        details: {
          idempotencyKey: exception.idempotencyKey,
        },
      };
    }

    if (exception instanceof WebhookSignatureInvalidException) {
      return {
        statusCode: HttpStatus.UNAUTHORIZED,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature verification failed',
        details: {
          gateway: exception.gateway,
        },
      };
    }

    if (exception instanceof GatewayTimeoutException) {
      return {
        statusCode: HttpStatus.GATEWAY_TIMEOUT,
        code: 'GATEWAY_TIMEOUT',
        message: 'Payment gateway did not respond in time',
        details: {
          gateway: exception.gateway,
          timeoutMs: exception.timeoutMs,
        },
      };
    }

    if (exception instanceof GatewayUnavailableException) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'GATEWAY_UNAVAILABLE',
        message: 'Payment gateway is currently unavailable',
        details: {
          gateway: exception.gateway,
        },
      };
    }

    if (exception instanceof NoGatewayAvailableException) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'NO_GATEWAY_AVAILABLE',
        message: 'No payment gateway is available for this payment method',
        details: {
          paymentMethod: exception.paymentMethod,
        },
      };
    }

    // Unknown error — do not leak internals
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private httpStatusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORISED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT',
    };

    return map[status] ?? 'UNKNOWN_ERROR';
  }
}
