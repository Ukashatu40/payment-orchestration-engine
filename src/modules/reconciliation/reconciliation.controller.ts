// src/modules/reconciliation/reconciliation.controller.ts

import {
  Controller,
  Post,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  Version,
} from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

@Controller('reconciliation')
@Version('1')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  // POST /api/v1/reconciliation/trigger
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async triggerReconciliation() {
    return this.reconciliationService.run();
  }

  // GET /api/v1/reconciliation/reports/:run_id
  @Get('reports/:runId')
  async getReport(@Param('runId') runId: string) {
    return this.reconciliationService.getReport(runId);
  }

  // GET /api/v1/reconciliation/anomalies
  @Get('anomalies')
  async getAnomalies() {
    return this.reconciliationService.getUnresolvedAnomalies();
  }
}
