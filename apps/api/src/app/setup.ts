import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { Pool } from 'pg';
import type { Env } from './config';
import { DB, runMigrations, type Db } from './db/database';
import { seedDemoData } from './db/seed';

/** Shared by main.ts and the tests, so tests run the app exactly as configured. */
export async function configureApp(app: INestApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }) });
  app.enableShutdownHooks();

  const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('TrialMatch API')
      .setDescription(
        'Clinical trials, de-identified patients, and (Week 2) AI eligibility matching',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(openApi));

  await runMigrations(app.get(Pool));
  if (config.get('SEED_DEMO_DATA', { infer: true }))
    await seedDemoData(app.get<Db>(DB));
}
