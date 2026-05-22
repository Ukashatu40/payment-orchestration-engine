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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { GatewayConfigRepository } from './repositories/gateway-config.repository';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { GatewayHealthService } from './health/gateway-health.service';
import { DataSource } from 'typeorm';
import { RoutingConfig } from './entities/routing-config.entity';
import { UpdateRoutingConfigDto } from './dto/update-routing-config.dto';
import { PaymentGateway } from '../../common/enums';

@ApiTags('gateways')
@ApiSecurity('X-API-Key')
@Controller({ path: 'gateways', version: '1' })
export class GatewaysController {
  constructor(
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly healthService: GatewayHealthService,
    private readonly dataSource: DataSource,
  ) {}

  // GET /api/v1/gateways
  @Get()
  @ApiOperation({ summary: 'List all payment gateways' })
  @ApiResponse({
    status: 200,
    description: 'List of payment gateways retrieved',
  })
  async listGateways() {
    const configs = await this.gatewayConfigRepo.findAll();
    const states = this.circuitBreaker.getAllStates();

    return configs.map((config) => ({
      gateway: config.gateway,
      isEnabled: config.isEnabled,
      healthScore: this.circuitBreaker.getHealthScore(config.gateway, config.supportedMethods[0]),
      circuitState: states.find((s) => s.gateway === config.gateway)?.state,
      // Parse the PostgreSQL array string if TypeORM returns it as string
      supportedMethods: Array.isArray(config.supportedMethods)
        ? config.supportedMethods
        : (config.supportedMethods as unknown as string)
            .replace(/^{|}$/g, '')
            .split(',')
            .filter(Boolean),
    }));
  }

  // GET /api/v1/gateways/:name/health
  @Get(':name/health')
  @ApiOperation({ summary: 'Get health status of a payment gateway' })
  @ApiResponse({ status: 200, description: 'Health status retrieved' })
  async getGatewayHealth(@Param('name') name: string) {
    const gateway = name.toUpperCase() as PaymentGateway;
    const config = await this.gatewayConfigRepo.findByGateway(gateway);
    const states = this.circuitBreaker.getAllStates().filter((s) => s.gateway === gateway);

    return {
      gateway,
      isEnabled: config?.isEnabled ?? false,
      circuitBreakerStates: states,
    };
  }

  // GET /api/v1/gateways/:name/metrics
  @Get(':name/metrics')
  @ApiOperation({ summary: 'Get metrics for a payment gateway' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved' })
  async getGatewayMetrics(@Param('name') name: string) {
    const metrics = await this.healthService.getSlidingWindowMetrics(10);
    const gateway = name.toUpperCase() as PaymentGateway;
    return metrics.filter((m) => m.gateway === gateway);
  }

  // PUT /api/v1/gateways/:name/config
  @Put(':name/config')
  @ApiOperation({ summary: 'Update configuration for a payment gateway' })
  @ApiResponse({ status: 200, description: 'Configuration updated' })
  @ApiParam({
    name: 'name',
    enum: PaymentGateway,
    description: 'Payment gateway name',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        isEnabled: { type: 'boolean' },
        cbFailureThreshold: { type: 'number', minimum: 0, maximum: 1 },
      },
      example: {
        isEnabled: true,
        cbFailureThreshold: 0.3,
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async updateGatewayConfig(
    @Param('name') name: string,
    @Body() body: Partial<{ isEnabled: boolean; cbFailureThreshold: number }>,
  ) {
    const gateway = name.toUpperCase() as PaymentGateway;
    await this.gatewayConfigRepo.updateConfig(gateway, body);

    // Reload circuit breaker config from DB without redeployment (A3.3)
    await this.circuitBreaker.loadConfigs();

    return { updated: true, gateway };
  }

  // GET /api/v1/routing/config
  @Get('/routing/config')
  @ApiOperation({ summary: 'Get current routing configuration' })
  @ApiResponse({ status: 200, description: 'Routing configuration retrieved' })
  async getRoutingConfig() {
    return this.dataSource
      .getRepository(RoutingConfig)
      .findOne({ where: { configKey: 'default' } });
  }

  // PUT /api/v1/routing/config
  @Put('/routing/config')
  @ApiOperation({ summary: 'Update routing configuration' })
  @ApiResponse({ status: 200, description: 'Routing configuration updated' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        weightSuccessRate: { type: 'number', minimum: 0, maximum: 1 },
        weightLatency: { type: 'number', minimum: 0, maximum: 1 },
        weightCost: { type: 'number', minimum: 0, maximum: 1 },
        weightHealth: { type: 'number', minimum: 0, maximum: 1 },
        weightFit: { type: 'number', minimum: 0, maximum: 1 },
      },
      example: {
        weightSuccessRate: 0.4,
        weightLatency: 0.2,
        weightCost: 0.2,
        weightHealth: 0.1,
        weightFit: 0.1,
      },
    },
  })
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

    await this.dataSource.getRepository(RoutingConfig).update({ configKey: 'default' }, body);

    return { updated: true };
  }
}
