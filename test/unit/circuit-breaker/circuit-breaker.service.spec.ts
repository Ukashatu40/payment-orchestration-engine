// test/unit/circuit-breaker/circuit-breaker.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreakerService } from '../../../src/modules/gateways/circuit-breaker/circuit-breaker.service';
import { CircuitBreakerState } from '../../../src/modules/gateways/circuit-breaker/circuit-breaker-state.enum';
import { GatewayConfigRepository } from '../../../src/modules/gateways/repositories/gateway-config.repository';
import { PaymentGateway, PaymentMethod } from '../../../src/common/enums';
import { GatewayUnavailableException } from '../../../src/common/exceptions';

const mockGatewayConfigRepo = {
  findAll: jest.fn().mockResolvedValue([
    {
      gateway: PaymentGateway.RAZORPAY,
      cbFailureThreshold: 3,
      cbTimeoutMs: 1000, // short timeout for tests
      cbHalfOpenRequests: 1,
    },
  ]),
};

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        {
          provide: GatewayConfigRepository,
          useValue: mockGatewayConfigRepo,
        },
      ],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
    await service.onModuleInit();
  });

  const gw = PaymentGateway.RAZORPAY;
  const pm = PaymentMethod.CARD_CREDIT;

  describe('initial state', () => {
    it('should start CLOSED', () => {
      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.CLOSED);
    });

    it('should return health score of 1.0 when CLOSED', () => {
      expect(service.getHealthScore(gw, pm)).toBe(1.0);
    });
  });

  describe('CLOSED → OPEN', () => {
    it('should trip after threshold failures', async () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.CLOSED);

      service.recordFailure(gw, pm); // 3rd failure = threshold
      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.OPEN);
    });

    it('should return health score of 0.0 when OPEN', () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      expect(service.getHealthScore(gw, pm)).toBe(0.0);
    });

    it('should throw GatewayUnavailableException when OPEN', async () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      await expect(service.guardRequest(gw, pm)).rejects.toThrow(GatewayUnavailableException);
    });
  });

  describe('OPEN → HALF_OPEN', () => {
    it('should allow probe after timeout elapses', async () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.OPEN);

      // Wait for timeout (1000ms in test config)
      await new Promise((r) => setTimeout(r, 1100));

      await expect(service.guardRequest(gw, pm)).resolves.not.toThrow();
      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should return health score of 0.5 when HALF_OPEN', async () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      await new Promise((r) => setTimeout(r, 1100));
      await service.guardRequest(gw, pm);

      expect(service.getHealthScore(gw, pm)).toBe(0.5);
    });
  });

  describe('HALF_OPEN → CLOSED', () => {
    it('should close circuit after successful probe', async () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      await new Promise((r) => setTimeout(r, 1100));
      await service.guardRequest(gw, pm);

      service.recordSuccess(gw, pm);
      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('HALF_OPEN → OPEN', () => {
    it('should re-open if probe fails', async () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      await new Promise((r) => setTimeout(r, 1100));
      await service.guardRequest(gw, pm);

      service.recordFailure(gw, pm);
      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('success resets failure count', () => {
    it('should not trip after non-consecutive failures', () => {
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);
      service.recordSuccess(gw, pm); // resets count
      service.recordFailure(gw, pm);
      service.recordFailure(gw, pm);

      expect(service.getState(gw, pm)).toBe(CircuitBreakerState.CLOSED);
    });
  });
});
