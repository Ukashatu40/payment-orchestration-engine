// test/integration/helpers/app.helper.ts

import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/common/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../../src/common/interceptors/trace-id.interceptor';
import { IdempotencyKeyInterceptor } from '../../../src/common/interceptors/idempotency.interceptor';
import { DataSource } from 'typeorm';

let app: NestFastifyApplication;
let dataSource: DataSource;

export async function buildApp(): Promise<NestFastifyApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    {
      // Disable NestJS body parser — we register our own below
      bodyParser: false,
    },
  );

  // Register raw body parser before app.init()
  // Must remove existing parser first then add ours
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

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TraceIdInterceptor());
  app.useGlobalInterceptors(new IdempotencyKeyInterceptor());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  dataSource = moduleFixture.get<DataSource>(DataSource);

  return app;
}

export function getDataSource(): DataSource {
  return dataSource;
}

export async function closeApp(): Promise<void> {
  await app.close();
}
