// src/common/guards/api-key.guard.ts

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly validKeys: Set<string>;

  constructor(private readonly configService: ConfigService) {
    // Support multiple API keys — comma-separated in env
    // e.g. API_KEYS=key1,key2,key3
    const raw = this.configService.get<string>('API_KEYS', '');
    this.validKeys = new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    if (!this.validKeys.has(apiKey)) {
      this.logger.warn('Invalid API key attempt', {
        ip: request.ip,
        url: request.url,
      });
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
