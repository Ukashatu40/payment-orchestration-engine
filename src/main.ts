// src/main.ts

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: 1_048_576,
      connectionTimeout: 65_000,
    }),
    {
      // Tell NestJS not to register any body parser
      // We register our own below to capture rawBody
      bodyParser: false,
    },
  );

  const configService = app.get(ConfigService);

  // Register our own JSON parser that captures rawBody first.
  // This runs before NestJS tries to register its own parser.
  // Satisfies Deliberate Error 5 fix — uses raw buffer for HMAC.
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: any, body: Buffer, done: any) => {
      _req.rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err, undefined);
      }
    },
  );

  // Validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
        excludeExtraneousValues: false,
      },
      // Ensure transform errors surface as 400 not 500
      exceptionFactory: (errors) => {
        const messages = errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
        return new (require('@nestjs/common').BadRequestException)(messages.join('; '));
      },
    }),
  );

  // Swagger setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PayFlow Orchestration Layer')
    .setDescription(
      'Production-grade payment orchestration API routing transactions ' +
        'across Razorpay, Stripe, PayU, and UPI with intelligent failover, ' +
        'idempotency, and complete audit trails.',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .addTag('payments', 'Payment initiation, capture, void, refund')
    .addTag('webhooks', 'Gateway webhook receivers and DLQ management')
    .addTag('gateways', 'Gateway health, metrics, and configuration')
    .addTag('reconciliation', 'Batch reconciliation and anomaly detection')
    .addTag('analytics', 'Transaction volume and success rate analytics')
    .addTag('health', 'System health check')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Serve Swagger UI at /api/docs
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // CORS configuration
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', '*'),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,X-API-Key',
  });

  // Also export as YAML to docs/api-specification.yaml
  const yamlDocument = yaml.dump(document);
  fs.writeFileSync('docs/api-specification.yaml', yamlDocument, 'utf8');

  // API versioning — /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`PayFlow Orchestration Layer running on port ${port}`);
}

bootstrap();
