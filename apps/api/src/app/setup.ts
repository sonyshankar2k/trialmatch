import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { Pool } from 'pg';
import type { Env } from './config';
import { DB, runMigrations, type Db } from './db/database';
import { seedDemoData } from './db/seed';

/** Shared by main.ts and the tests, so tests run the app exactly as configured. */
export async function configureApp(app: INestApplication): Promise<void> {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api');
  // Behind a proxy, use its X-Forwarded-For so rate limits and logs see the real client.
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy > 0)
    (app as NestExpressApplication).set('trust proxy', trustProxy);
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

  serveWebApp(
    app as NestExpressApplication,
    config.get('WEB_DIST_DIR', { infer: true }),
  );

  await runMigrations(app.get(Pool));
  if (config.get('SEED_DEMO_DATA', { infer: true }))
    await seedDemoData(app.get<Db>(DB));
}

/**
 * Single-container deployment: the API also serves the built React app.
 * Hashed files under /assets are cached for a year; every other non-API GET that
 * wants HTML gets index.html (never cached), so React Router handles deep links.
 */
function serveWebApp(app: NestExpressApplication, dir: string | undefined) {
  if (!dir) return;
  app.useStaticAssets(dir, {
    index: false,
    setHeaders: (res, path) =>
      res.setHeader(
        'Cache-Control',
        path.includes(`${join('/', 'assets', '/')}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      ),
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.method !== 'GET' ||
      req.path.startsWith('/api') ||
      !req.accepts('html')
    )
      return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(dir, 'index.html'));
  });
}
