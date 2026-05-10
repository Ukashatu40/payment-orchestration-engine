// src/main.ts
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureRawBodyForWebhooks } from './modules/webhooks/webhooks.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Log structured JSON — satisfies Section A8.5 tracing requirement
      logger: {
        level: process.env.LOG_LEVEL ?? 'info',
        serializers: {
          req(req) {
            return {
              method: req.method,
              url: req.url,
              // Never log Authorization headers
              headers: {
                'x-trace-id': req.headers['x-trace-id'],
                'content-type': req.headers['content-type'],
              },
            };
          },
        },
      },
      // Critical: sets body size limit for webhook payloads
      bodyLimit: 1_048_576, // 1MB
      // Connection timeout slightly above max gateway timeout (60s UPI)
      connectionTimeout: 65_000,
    }),
  );

  // Configure raw body parsing for webhook endpoints (Section A8.3)
  configureRawBodyForWebhooks(app);

  const configService = app.get(ConfigService);

  // Global validation pipe — rejects malformed payment requests early
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strips unknown fields
      forbidNonWhitelisted: true,
      transform: true, // auto-transforms string amounts to bigint
      transformOptions: {
        enableImplicitConversion: false, // explicit only — financial safety
      },
    }),
  );

  // Global exception filter — translates all errors to standard format (A7.2)
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Trace ID on every request (Section A8.5)
  app.useGlobalInterceptors(new TraceIdInterceptor());

  // API versioning — /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  const port = configService.get<number>('PORT', 3000);
  // Fastify requires '0.0.0.0' explicitly for Docker
  await app.listen(port, '0.0.0.0');

  console.log(`PayFlow Orchestration Layer running on port ${port}`);
}

bootstrap();
