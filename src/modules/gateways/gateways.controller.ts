// src/modules/gateways/gateways.controller.ts

import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Post,
  Version,
} from '@nestjs/common';
import { GatewayConfigRepository } from './repositories/gateway-config.repository';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { GatewayHealthService } from './health/gateway-health.service';
import { DataSource } from 'typeorm';
import { RoutingConfig } from './entities/routing-config.entity';
import { UpdateRoutingConfigDto } from './dto/update-routing-config.dto';
import { PaymentGateway } from '../../common/enums';

@Controller('gateways')
@Version('1')
export class GatewaysController {
  constructor(
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly healthService: GatewayHealthService,
    private readonly dataSource: DataSource,
  ) {}

  // GET /api/v1/gateways
  @Get()
  async listGateways() {
    const configs = await this.gatewayConfigRepo.findAll();
    const states = this.circuitBreaker.getAllStates();

    return configs.map((config) => ({
      gateway: config.gateway,
      isEnabled: config.isEnabled,
      healthScore: this.circuitBreaker.getHealthScore(
        config.gateway,
        config.supportedMethods[0],
      ),
      circuitState: states.find((s) => s.gateway === config.gateway)?.state,
      supportedMethods: config.supportedMethods,
    }));
  }

  // GET /api/v1/gateways/:name/health
  @Get(':name/health')
  async getGatewayHealth(@Param('name') name: string) {
    const gateway = name.toUpperCase() as PaymentGateway;
    const config = await this.gatewayConfigRepo.findByGateway(gateway);
    const states = this.circuitBreaker
      .getAllStates()
      .filter((s) => s.gateway === gateway);

    return {
      gateway,
      isEnabled: config?.isEnabled ?? false,
      circuitBreakerStates: states,
    };
  }

  // GET /api/v1/gateways/:name/metrics
  @Get(':name/metrics')
  async getGatewayMetrics(@Param('name') name: string) {
    const metrics = await this.healthService.getSlidingWindowMetrics(10);
    const gateway = name.toUpperCase() as PaymentGateway;
    return metrics.filter((m) => m.gateway === gateway);
  }

  // PUT /api/v1/gateways/:name/config
  @Put(':name/config')
  @HttpCode(HttpStatus.OK)
  async updateGatewayConfig(
    @Param('name') name: string,
    @Body() body: Partial<{ isEnabled: boolean; cbFailureThreshold: number }>,
  ) {
    const gateway = name.toUpperCase() as PaymentGateway;
    await this.gatewayConfigRepo.updateConfig(gateway, body as any);

    // Reload circuit breaker config from DB without redeployment (A3.3)
    await this.circuitBreaker.loadConfigs();

    return { updated: true, gateway };
  }

  // GET /api/v1/routing/config
  @Get('/routing/config')
  async getRoutingConfig() {
    return this.dataSource
      .getRepository(RoutingConfig)
      .findOne({ where: { configKey: 'default' } });
  }

  // PUT /api/v1/routing/config
  @Put('/routing/config')
  @HttpCode(HttpStatus.OK)
  async updateRoutingConfig(@Body() body: UpdateRoutingConfigDto) {
    // Validate weights sum to 1.0
    const sum =
      body.weightSuccessRate +
      body.weightLatency +
      body.weightCost +
      body.weightHealth +
      body.weightFit;

    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(`Routing weights must sum to 1.0, got ${sum}`);
    }

    await this.dataSource
      .getRepository(RoutingConfig)
      .update({ configKey: 'default' }, body);

    return { updated: true };
  }
}
