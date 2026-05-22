// src/common/interceptors/idempotency.interceptor.ts

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';

// Enforces that POST endpoints carry an Idempotency-Key header.
// Applied selectively — only on payment mutation endpoints.
@Injectable()
export class IdempotencyKeyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // Only enforce on POST requests
    if (request.method !== 'POST') {
      return next.handle();
    }

    // Webhook endpoints manage their own idempotency via event_id
    if (request.url.includes('/webhooks/')) {
      return next.handle();
    }

    // Health and reconciliation trigger endpoints are exempt
    const exemptPaths = ['/health', '/reconciliation/trigger'];
    if (exemptPaths.some((p) => request.url.includes(p))) {
      return next.handle();
    }

    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required for POST requests');
    }

    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be a valid UUID v4');
    }

    return next.handle();
  }
}
