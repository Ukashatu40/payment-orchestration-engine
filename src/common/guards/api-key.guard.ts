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

  // Routes that bypass API key authentication
  private readonly publicPaths = ['/api/v1/webhooks/', '/api/v1/health'];

  constructor(private readonly configService: ConfigService) {
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

    // Skip API key check for public paths
    const isPublic = this.publicPaths.some((path) => request.url.startsWith(path));

    if (isPublic) return true;

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
