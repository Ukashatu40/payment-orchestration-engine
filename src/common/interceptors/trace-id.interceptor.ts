// src/common/interceptors/trace-id.interceptor.ts

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TraceIdInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    // Use incoming trace ID or generate a new one (Section A8.5)
    const traceId = (request.headers['x-trace-id'] as string) ?? uuidv4();

    // Attach to request so controllers and services can read it
    (request as any).traceId = traceId;

    // Echo trace ID back in response headers for client correlation
    reply.header('x-trace-id', traceId);

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log('Request completed', {
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            durationMs: Date.now() - startTime,
            traceId,
          });
        },
        error: (err: Error) => {
          this.logger.error('Request failed', {
            method: request.method,
            url: request.url,
            error: err.message,
            durationMs: Date.now() - startTime,
            traceId,
          });
        },
      }),
    );
  }
}
