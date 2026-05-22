// test/unit/filters/global-exception.filter.spec.ts

import { GlobalExceptionFilter } from '../../../src/common/filters/global-exception.filter';
import { HttpException, HttpStatus, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  InvalidStateTransitionException,
  IdempotencyConflictException,
  WebhookSignatureInvalidException,
  GatewayTimeoutException,
  NoGatewayAvailableException,
} from '../../../src/common/exceptions';
import { TransactionState, PaymentGateway, PaymentMethod } from '../../../src/common/enums';

// ----------------------------------------------------------------
// Mock ArgumentsHost
// ----------------------------------------------------------------
function buildHost(traceId = 'trace-test-001') {
  const mockReply = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };

  const mockRequest = {
    traceId,
    url: '/api/v1/payments',
    method: 'POST',
  };

  return {
    switchToHttp: () => ({
      getResponse: () => mockReply,
      getRequest: () => mockRequest,
    }),
    mockReply,
  };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  // ----------------------------------------------------------------
  // NestJS HTTP exceptions
  // ----------------------------------------------------------------
  describe('HttpException handling', () => {
    it('should return 404 for NotFoundException', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new NotFoundException('Transaction not found'), host);

      expect(mockReply.status).toHaveBeenCalledWith(404);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Transaction not found');
    });

    it('should return 400 for BadRequestException', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new BadRequestException('amountPaise must be positive'), host);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ----------------------------------------------------------------
  // Domain exceptions
  // ----------------------------------------------------------------
  describe('InvalidStateTransitionException', () => {
    it('should return 422 with transition details', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(
        new InvalidStateTransitionException(
          'txn-001',
          TransactionState.CREATED,
          TransactionState.REFUNDED,
          [TransactionState.ROUTE_SELECTED, TransactionState.ABANDONED],
        ),
        host,
      );

      expect(mockReply.status).toHaveBeenCalledWith(422);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(body.error.details.fromState).toBe(TransactionState.CREATED);
      expect(body.error.details.toState).toBe(TransactionState.REFUNDED);
      expect(body.error.details.validTargets).toContain(TransactionState.ROUTE_SELECTED);
    });
  });

  describe('IdempotencyConflictException', () => {
    it('should return 409', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new IdempotencyConflictException('idem-key-001', 'merchant-001'), host);

      expect(mockReply.status).toHaveBeenCalledWith(409);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('WebhookSignatureInvalidException', () => {
    it('should return 401', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new WebhookSignatureInvalidException(PaymentGateway.RAZORPAY), host);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
      expect(body.error.details.gateway).toBe(PaymentGateway.RAZORPAY);
    });
  });

  describe('GatewayTimeoutException', () => {
    it('should return 504', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new GatewayTimeoutException(PaymentGateway.RAZORPAY, 30000, 'txn-001'), host);

      expect(mockReply.status).toHaveBeenCalledWith(504);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('GATEWAY_TIMEOUT');
      expect(body.error.details.gateway).toBe(PaymentGateway.RAZORPAY);
      expect(body.error.details.timeoutMs).toBe(30000);
    });
  });

  describe('NoGatewayAvailableException', () => {
    it('should return 503', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new NoGatewayAvailableException(PaymentMethod.CARD_CREDIT), host);

      expect(mockReply.status).toHaveBeenCalledWith(503);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('NO_GATEWAY_AVAILABLE');
    });
  });

  // ----------------------------------------------------------------
  // Unknown errors — must never leak internals
  // ----------------------------------------------------------------
  describe('unknown errors', () => {
    it('should return 500 without leaking stack trace', () => {
      const { switchToHttp, mockReply } = buildHost();
      const host = { switchToHttp } as any;

      filter.catch(new Error('Database connection pool exhausted'), host);

      expect(mockReply.status).toHaveBeenCalledWith(500);
      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred');

      // Stack trace must not be in response
      expect(JSON.stringify(body)).not.toContain('Database connection pool');
    });
  });

  // ----------------------------------------------------------------
  // Response shape always includes request_id and timestamp
  // ----------------------------------------------------------------
  describe('response envelope', () => {
    it('should always include request_id matching traceId', () => {
      const traceId = 'my-trace-id-001';
      const { switchToHttp, mockReply } = buildHost(traceId);
      const host = { switchToHttp } as any;

      filter.catch(new NotFoundException('Not found'), host);

      const body = mockReply.send.mock.calls[0][0];
      expect(body.error.request_id).toBe(traceId);
      expect(body.error.timestamp).toBeDefined();
    });
  });
});
