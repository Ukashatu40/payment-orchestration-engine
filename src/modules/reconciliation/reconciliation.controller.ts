// src/modules/reconciliation/reconciliation.controller.ts

import { Controller, Post, Get, Param, HttpCode, HttpStatus, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('reconciliation')
@ApiSecurity('X-API-Key')
@Controller({ path: 'reconciliation', version: '1' })
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  // POST /api/v1/reconciliation/trigger
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger reconciliation process' })
  @ApiResponse({ status: 200, description: 'Reconciliation triggered' })
  async triggerReconciliation() {
    return this.reconciliationService.run();
  }

  // GET /api/v1/reconciliation/reports/:run_id
  @Get('reports/:runId')
  @ApiOperation({ summary: 'Get reconciliation report' })
  @ApiResponse({ status: 200, description: 'Report retrieved' })
  async getReport(@Param('runId') runId: string) {
    return this.reconciliationService.getReport(runId);
  }

  // GET /api/v1/reconciliation/anomalies
  @Get('anomalies')
  @ApiOperation({ summary: 'Get unresolved anomalies' })
  @ApiResponse({ status: 200, description: 'Anomalies retrieved' })
  async getAnomalies() {
    return this.reconciliationService.getUnresolvedAnomalies();
  }
}
