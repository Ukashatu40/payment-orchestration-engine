// src/modules/reconciliation/reconciliation.controller.ts

import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireCsrf } from '../auth/decorators/require-csrf.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../../common/enums';
import { UserAuditLogRepository } from '../users/repositories/user-audit-log.repository';
import { AnomalyDto } from './dto/anomaly.dto';
import { ReconciliationRunResultDto } from './dto/reconciliation-run-result.dto';
import { ResolveAnomalyResultDto } from './dto/resolve-anomaly-result.dto';

@ApiTags('reconciliation')
@ApiSecurity('X-API-Key')
@Controller({ path: 'reconciliation', version: '1' })
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly auditLogRepo: UserAuditLogRepository,
  ) {}

  // POST /api/v1/reconciliation/trigger
  // Dangerous: kicks off a full reconciliation batch on demand.
  // Requires a real user session with an admin role.
  @Post('trigger')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN)
  @RequireCsrf()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger reconciliation process' })
  @ApiResponse({
    status: 200,
    description: 'Reconciliation triggered',
    type: ReconciliationRunResultDto,
  })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN or OPS_ADMIN' })
  async triggerReconciliation(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReconciliationRunResultDto> {
    const result = await this.reconciliationService.run();

    await this.auditLogRepo.record({
      actorUserId: user.id,
      action: 'RECONCILIATION_TRIGGERED',
      targetType: 'reconciliation_run',
      targetId: result.runId,
    });

    return result;
  }

  // GET /api/v1/reconciliation/reports/:run_id
  @Get('reports/:runId')
  @ApiOperation({ summary: 'Get reconciliation report' })
  @ApiResponse({ status: 200, description: 'Report retrieved', type: [AnomalyDto] })
  async getReport(@Param('runId') runId: string): Promise<AnomalyDto[]> {
    return this.reconciliationService.getReport(runId);
  }

  // GET /api/v1/reconciliation/anomalies
  @Get('anomalies')
  @ApiOperation({ summary: 'Get unresolved anomalies' })
  @ApiResponse({ status: 200, description: 'Anomalies retrieved', type: [AnomalyDto] })
  async getAnomalies(): Promise<AnomalyDto[]> {
    return this.reconciliationService.getUnresolvedAnomalies();
  }

  // POST /api/v1/reconciliation/anomalies/:id/resolve
  // Ops workflow addition — anomalies were previously read-only via
  // the API (only auto-resolution during a run could clear one).
  @Post('anomalies/:id/resolve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN)
  @RequireCsrf()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an anomaly resolved/investigated' })
  @ApiResponse({
    status: 200,
    description: 'Anomaly marked resolved',
    type: ResolveAnomalyResultDto,
  })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN or OPS_ADMIN' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { notes: { type: 'string' } },
      required: ['notes'],
      example: { notes: 'Confirmed with gateway support — settled, false positive.' },
    },
  })
  async resolveAnomaly(
    @Param('id') id: string,
    @Body() body: { notes: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResolveAnomalyResultDto> {
    await this.reconciliationService.resolveAnomaly(id, body.notes);

    await this.auditLogRepo.record({
      actorUserId: user.id,
      action: 'ANOMALY_RESOLVED',
      targetType: 'reconciliation_log',
      targetId: id,
      metadata: { notes: body.notes },
    });

    return { resolved: true };
  }
}
