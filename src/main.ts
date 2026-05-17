// src/main.ts

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

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
      (_req as any).rawBody = body;
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
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // API versioning — /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`PayFlow Orchestration Layer running on port ${port}`);
}

bootstrap();
