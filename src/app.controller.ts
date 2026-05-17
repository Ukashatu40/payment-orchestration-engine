// src/app.controller.ts

import { Controller, Get, Version } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(private readonly dataSource: DataSource) {}

  // GET /api/v1/health
  @Get('health')
  @Version('1')
  async health() {
    let dbStatus = 'ok';

    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbStatus = 'error';
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        api: 'ok',
      },
    };
  }
}
