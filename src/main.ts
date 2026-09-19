// src/main.ts

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import * as fs from 'fs';
import * as path from 'path';
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

  // Auth cookies (payflow_access_token / payflow_refresh_token, see
  // auth.controller.ts) are httpOnly and not signed here — the JWT
  // itself is signed/verified, and the refresh token is an opaque
  // random value hashed server-side, so an unsigned cookie is fine.
  // Type provider generics between this Fastify instance (as exposed
  // by Nest's FastifyAdapter) and @fastify/cookie's plugin signature
  // don't line up cleanly — cast at the boundary, consistent with the
  // existing `any`-typed raw Fastify interop just below.
  await fastify.register(fastifyCookie as any);

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

  // Interswitch's hosted checkout POSTs the payer's browser back to us as a
  // form (application/x-www-form-urlencoded); Fastify has no default parser.
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req: any, body: string, done: any) => {
      done(null, Object.fromEntries(new URLSearchParams(body)));
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

  // API versioning — /api/v1/... — must be set BEFORE
  // SwaggerModule.createDocument() below. createDocument() reflects
  // the app's routes as configured at the moment it's called; setting
  // the prefix/versioning after it (as this previously did) generates
  // an OpenAPI spec with bare paths like /payments instead of
  // /api/v1/payments, causing Swagger UI's "Try it out" to 404 against
  // the real server even though the actual API works correctly.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  // Swagger setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PayFlow Orchestration Layer')
    .setDescription(
      'Production-grade payment orchestration API routing transactions ' +
        'across Razorpay, Stripe, PayU, UPI, Paystack, Flutterwave, ' +
        'Interswitch, and Opay with intelligent failover, idempotency, ' +
        'and complete audit trails.',
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
  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const yamlDocument = yaml.dump(document);
  fs.writeFileSync(path.join(docsDir, 'api-specification.yaml'), yamlDocument, 'utf8');

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');

  console.log(`PayFlow Orchestration Layer running on port ${port}`);
}

bootstrap();
