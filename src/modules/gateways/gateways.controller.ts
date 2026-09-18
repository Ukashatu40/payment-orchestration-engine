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
  BadRequestException,
  NotFoundException,
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
import { PaymentGateway, PaymentMethod, UserRole } from '../../common/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UserAuditLogRepository } from '../users/repositories/user-audit-log.repository';
import { GatewaySummaryDto } from './dto/gateway-summary.dto';
import { GatewayHealthDto } from './dto/gateway-health.dto';
import { GatewayMetricsDto } from './dto/gateway-metrics.dto';
import { GatewayConfigUpdateResultDto } from './dto/gateway-config-update-result.dto';
import { RoutingConfigResponseDto } from './dto/routing-config-response.dto';

@ApiTags('gateways')
@ApiSecurity('X-API-Key')
@Controller({ path: 'gateways', version: '1' })
export class GatewaysController {
  constructor(
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly healthService: GatewayHealthService,
    private readonly dataSource: DataSource,
    private readonly auditLogRepo: UserAuditLogRepository,
  ) {}

  // GET /api/v1/gateways
  @Get()
  @ApiOperation({ summary: 'List all payment gateways' })
  @ApiResponse({
    status: 200,
    description: 'List of payment gateways retrieved',
    type: [GatewaySummaryDto],
  })
  async listGateways(): Promise<GatewaySummaryDto[]> {
    const configs = await this.gatewayConfigRepo.findAll();
    const states = this.circuitBreaker.getAllStates();

    return configs.map((config) => {
      // Parse the PostgreSQL array string if TypeORM returns it as string —
      // must happen before use, not after: indexing the raw string (e.g.
      // "{CARD_CREDIT,...}"[0]) silently returns "{" instead of the first
      // method, which previously got passed straight into getHealthScore(),
      // querying a bogus never-failed circuit breaker entry and making
      // every gateway report a meaningless 100% health score.
      const supportedMethods: PaymentMethod[] = Array.isArray(config.supportedMethods)
        ? config.supportedMethods
        : ((config.supportedMethods as unknown as string)
            .replace(/^{|}$/g, '')
            .split(',')
            .filter(Boolean) as PaymentMethod[]);

      return {
        gateway: config.gateway,
        isEnabled: config.isEnabled,
        healthScore: this.circuitBreaker.getHealthScore(config.gateway, supportedMethods[0]),
        circuitState: states.find((s) => s.gateway === config.gateway)?.state,
        supportedMethods,
      };
    });
  }

  // GET /api/v1/gateways/:name/health
  @Get(':name/health')
  @ApiOperation({ summary: 'Get health status of a payment gateway' })
  @ApiParam({ name: 'name', enum: PaymentGateway })
  @ApiResponse({ status: 200, description: 'Health status retrieved', type: GatewayHealthDto })
  async getGatewayHealth(@Param('name') name: string): Promise<GatewayHealthDto> {
    const gateway = name.toUpperCase() as PaymentGateway;
    const config = await this.gatewayConfigRepo.findByGateway(gateway);
    const states = this.circuitBreaker.getAllStates().filter((s) => s.gateway === gateway);

    return {
      gateway,
      isEnabled: config?.isEnabled ?? false,
      cbFailureThreshold: config?.cbFailureThreshold ?? 0,
      circuitBreakerStates: states,
    };
  }

  // GET /api/v1/gateways/:name/metrics
  @Get(':name/metrics')
  @ApiOperation({ summary: 'Get metrics for a payment gateway' })
  @ApiParam({ name: 'name', enum: PaymentGateway })
  @ApiResponse({ status: 200, description: 'Metrics retrieved', type: [GatewayMetricsDto] })
  async getGatewayMetrics(@Param('name') name: string): Promise<GatewayMetricsDto[]> {
    const metrics = await this.healthService.getSlidingWindowMetrics(10);
    const gateway = name.toUpperCase() as PaymentGateway;
    return metrics.filter((m) => m.gateway === gateway);
  }

  // PUT /api/v1/gateways/:name/config
  // Dangerous, high-blast-radius: can disable a live payment gateway.
  // Requires a real user session with an admin role — never reachable
  // via the legacy API key (RolesGuard rejects an "apiKey" principal
  // outright, see roles.guard.ts).
  @Put(':name/config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN)
  @ApiOperation({ summary: 'Update configuration for a payment gateway' })
  @ApiResponse({
    status: 200,
    description: 'Configuration updated',
    type: GatewayConfigUpdateResultDto,
  })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN or OPS_ADMIN' })
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
        cbFailureThreshold: {
          type: 'integer',
          minimum: 1,
          description: 'Consecutive failure count that trips the circuit breaker open',
        },
      },
      example: {
        isEnabled: true,
        cbFailureThreshold: 5,
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async updateGatewayConfig(
    @Param('name') name: string,
    @Body() body: Partial<{ isEnabled: boolean; cbFailureThreshold: number }>,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GatewayConfigUpdateResultDto> {
    const gateway = name.toUpperCase() as PaymentGateway;
    await this.gatewayConfigRepo.updateConfig(gateway, body);

    // Reload circuit breaker config from DB without redeployment (A3.3)
    await this.circuitBreaker.loadConfigs();

    await this.auditLogRepo.record({
      actorUserId: user.id,
      action: 'GATEWAY_CONFIG_CHANGED',
      targetType: 'gateway',
      targetId: gateway,
      metadata: body,
    });

    return { updated: true, gateway };
  }

  // GET /api/v1/routing/config
  @Get('/routing/config')
  @ApiOperation({ summary: 'Get current routing configuration' })
  @ApiResponse({
    status: 200,
    description: 'Routing configuration retrieved',
    type: RoutingConfigResponseDto,
  })
  async getRoutingConfig(): Promise<RoutingConfigResponseDto> {
    const config = await this.dataSource
      .getRepository(RoutingConfig)
      .findOne({ where: { configKey: 'default' } });

    if (!config) {
      throw new NotFoundException('Routing configuration not found');
    }

    return RoutingConfigResponseDto.fromEntity(config);
  }

  // PUT /api/v1/routing/config
  // Dangerous, high-blast-radius: live-affects which gateway every
  // future transaction routes to. Same admin-role requirement as
  // gateway config above.
  @Put('/routing/config')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN)
  @ApiOperation({ summary: 'Update routing configuration' })
  @ApiResponse({
    status: 200,
    description: 'Routing configuration updated',
    type: RoutingConfigResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN or OPS_ADMIN' })
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
  async updateRoutingConfig(
    @Body() body: UpdateRoutingConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RoutingConfigResponseDto> {
    // Validate weights sum to 1.0
    const sum =
      body.weightSuccessRate +
      body.weightLatency +
      body.weightCost +
      body.weightHealth +
      body.weightFit;

    if (Math.abs(sum - 1.0) > 0.001) {
      // A plain Error here previously fell through to the global
      // filter's generic 500 branch — this is a client input error.
      throw new BadRequestException(`Routing weights must sum to 1.0, got ${sum}`);
    }

    const repo = this.dataSource.getRepository(RoutingConfig);
    await repo.update({ configKey: 'default' }, body);

    await this.auditLogRepo.record({
      actorUserId: user.id,
      action: 'ROUTING_CONFIG_CHANGED',
      targetType: 'routing_config',
      targetId: 'default',
      metadata: body as unknown as Record<string, unknown>,
    });

    const updated = await repo.findOneOrFail({ where: { configKey: 'default' } });
    return RoutingConfigResponseDto.fromEntity(updated);
  }
}
