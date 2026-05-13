// test/unit/gateway-router/gateway-router.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GatewayRouterService } from '../../../src/modules/gateways/router/gateway-router.service';
import { GatewayAdapterRegistry } from '../../../src/modules/gateways/adapters/gateway-adapter.registry';
import { CircuitBreakerService } from '../../../src/modules/gateways/circuit-breaker/circuit-breaker.service';
import { GatewayHealthService } from '../../../src/modules/gateways/health/gateway-health.service';
import { GatewayConfigRepository } from '../../../src/modules/gateways/repositories/gateway-config.repository';
import { CircuitBreakerState } from '../../../src/modules/gateways/circuit-breaker/circuit-breaker-state.enum';
import { PaymentGateway, PaymentMethod } from '../../../src/common/enums';
import { NoGatewayAvailableException } from '../../../src/common/exceptions';

// ----------------------------------------------------------------
// Test fixtures — match Section A3.4 historical data
// ----------------------------------------------------------------
const mockGatewayConfigs = [
  {
    gateway: PaymentGateway.RAZORPAY,
    isEnabled: true,
    supportedMethods: [PaymentMethod.CARD_CREDIT, PaymentMethod.CARD_DEBIT],
    costPercentage: 0.02,
    costFixedPaise: BigInt(200),
    cbFailureThreshold: 5,
    cbTimeoutMs: 30000,
    cbHalfOpenRequests: 1,
  },
  {
    gateway: PaymentGateway.STRIPE,
    isEnabled: true,
    supportedMethods: [PaymentMethod.CARD_CREDIT, PaymentMethod.CARD_DEBIT],
    costPercentage: 0.025,
    costFixedPaise: BigInt(300),
    cbFailureThreshold: 5,
    cbTimeoutMs: 30000,
    cbHalfOpenRequests: 1,
  },
  {
    gateway: PaymentGateway.UPI,
    isEnabled: true,
    supportedMethods: [PaymentMethod.UPI],
    costPercentage: 0.0,
    costFixedPaise: BigInt(0),
    cbFailureThreshold: 5,
    cbTimeoutMs: 30000,
    cbHalfOpenRequests: 1,
  },
];

const mockMetrics = [
  {
    gateway: PaymentGateway.RAZORPAY,
    successRate: 0.941, // 12:00–18:00 from A3.4
    p95LatencyMs: 780,
    totalCount: 32000,
  },
  {
    gateway: PaymentGateway.STRIPE,
    successRate: 0.975, // 12:00–18:00 from A3.4
    p95LatencyMs: 420,
    totalCount: 28500,
  },
];

const mockRoutingConfig = {
  configKey: 'default',
  weightSuccessRate: 0.35,
  weightLatency: 0.2,
  weightCost: 0.2,
  weightHealth: 0.15,
  weightFit: 0.1,
  slidingWindowMinutes: 10,
  degradedSkipThreshold: 0.2,
};

// ----------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------
const mockGatewayConfigRepo = {
  findEnabledForMethod: jest.fn(),
  findAll: jest.fn().mockResolvedValue(mockGatewayConfigs),
};

const mockHealthService = {
  getSlidingWindowMetrics: jest.fn(),
};

const mockCircuitBreaker = {
  getHealthScore: jest.fn().mockReturnValue(1.0),
  getState: jest.fn().mockReturnValue(CircuitBreakerState.CLOSED),
};

const mockDataSource = {
  getRepository: jest.fn().mockReturnValue({
    findOne: jest.fn().mockResolvedValue(mockRoutingConfig),
    create: jest.fn().mockImplementation((data) => data),
    save: jest.fn().mockResolvedValue([]),
  }),
};

describe('GatewayRouterService', () => {
  let service: GatewayRouterService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockGatewayConfigRepo.findEnabledForMethod.mockResolvedValue(
      mockGatewayConfigs.filter((c) =>
        c.supportedMethods.includes(PaymentMethod.CARD_CREDIT),
      ),
    );

    mockHealthService.getSlidingWindowMetrics.mockResolvedValue(mockMetrics);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayRouterService,
        { provide: GatewayAdapterRegistry, useValue: {} },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: GatewayHealthService, useValue: mockHealthService },
        { provide: GatewayConfigRepository, useValue: mockGatewayConfigRepo },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<GatewayRouterService>(GatewayRouterService);
  });

  // ----------------------------------------------------------------
  // Core routing logic
  // ----------------------------------------------------------------
  describe('selectGateway', () => {
    it('should select Stripe over Razorpay during peak hours', async () => {
      // Stripe has higher success rate (97.5%) and lower latency (420ms)
      // vs Razorpay (94.1%, 780ms) during 12:00-18:00 per Section A3.4
      const selected = await service.selectGateway(
        'txn-123',
        PaymentMethod.CARD_CREDIT,
        'trace-123',
      );

      expect(selected).toBe(PaymentGateway.STRIPE);
    });

    it('should throw NoGatewayAvailableException when no gateways support method', async () => {
      mockGatewayConfigRepo.findEnabledForMethod.mockResolvedValue([]);

      await expect(
        service.selectGateway(
          'txn-123',
          PaymentMethod.CARD_CREDIT,
          'trace-123',
        ),
      ).rejects.toThrow(NoGatewayAvailableException);
    });

    it('should record routing decision for all scored gateways', async () => {
      await service.selectGateway(
        'txn-123',
        PaymentMethod.CARD_CREDIT,
        'trace-123',
      );

      const repoMock = mockDataSource.getRepository();
      expect(repoMock.save).toHaveBeenCalledTimes(1);

      // Both Razorpay and Stripe should have routing records
      const savedEntries = repoMock.save.mock.calls[0][0];
      expect(savedEntries).toHaveLength(2);

      const winner = savedEntries.find((e: any) => e.wasSelected === true);
      expect(winner.gateway).toBe(PaymentGateway.STRIPE);

      const loser = savedEntries.find((e: any) => e.wasSelected === false);
      expect(loser.gateway).toBe(PaymentGateway.RAZORPAY);
    });

    it('should select only UPI when payment method is UPI', async () => {
      mockGatewayConfigRepo.findEnabledForMethod.mockResolvedValue(
        mockGatewayConfigs.filter((c) =>
          c.supportedMethods.includes(PaymentMethod.UPI),
        ),
      );
      mockHealthService.getSlidingWindowMetrics.mockResolvedValue([
        {
          gateway: PaymentGateway.UPI,
          successRate: 0.98,
          p95LatencyMs: 350,
          totalCount: 38000,
        },
      ]);

      const selected = await service.selectGateway(
        'txn-123',
        PaymentMethod.UPI,
        'trace-123',
      );

      expect(selected).toBe(PaymentGateway.UPI);
    });
  });

  // ----------------------------------------------------------------
  // Circuit breaker integration
  // ----------------------------------------------------------------
  describe('degraded gateway handling', () => {
    it('should skip HALF_OPEN gateway when second-best is within threshold', async () => {
      // Stripe is HALF_OPEN but would be selected (higher score)
      mockCircuitBreaker.getState.mockImplementation((gw) =>
        gw === PaymentGateway.STRIPE
          ? CircuitBreakerState.HALF_OPEN
          : CircuitBreakerState.CLOSED,
      );
      mockCircuitBreaker.getHealthScore.mockImplementation((gw) =>
        gw === PaymentGateway.STRIPE ? 0.5 : 1.0,
      );

      // With degraded health score, Razorpay may outscore Stripe
      const selected = await service.selectGateway(
        'txn-123',
        PaymentMethod.CARD_CREDIT,
        'trace-123',
      );

      // Razorpay should be preferred when Stripe is degraded
      expect(selected).toBe(PaymentGateway.RAZORPAY);
    });
  });

  // ----------------------------------------------------------------
  // Division by zero guard (Deliberate Error 2 fix)
  // ----------------------------------------------------------------
  describe('normalisation edge cases', () => {
    it('should not throw when all gateways have identical latency', async () => {
      mockHealthService.getSlidingWindowMetrics.mockResolvedValue([
        {
          gateway: PaymentGateway.RAZORPAY,
          successRate: 0.95,
          p95LatencyMs: 400,
          totalCount: 1000,
        },
        {
          gateway: PaymentGateway.STRIPE,
          successRate: 0.97,
          p95LatencyMs: 400, // same latency as Razorpay
          totalCount: 1000,
        },
      ]);

      await expect(
        service.selectGateway(
          'txn-123',
          PaymentMethod.CARD_CREDIT,
          'trace-123',
        ),
      ).resolves.not.toThrow();
    });

    it('should not throw when only one gateway is available', async () => {
      mockGatewayConfigRepo.findEnabledForMethod.mockResolvedValue([
        mockGatewayConfigs[0], // only Razorpay
      ]);
      mockHealthService.getSlidingWindowMetrics.mockResolvedValue([
        {
          gateway: PaymentGateway.RAZORPAY,
          successRate: 0.95,
          p95LatencyMs: 400,
          totalCount: 1000,
        },
      ]);

      const selected = await service.selectGateway(
        'txn-123',
        PaymentMethod.CARD_CREDIT,
        'trace-123',
      );

      expect(selected).toBe(PaymentGateway.RAZORPAY);
    });
  });
});
