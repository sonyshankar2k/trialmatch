/**
 * TrialMatch API.  Run: npx nx serve api   ·   Docs: http://localhost:3000/api/docs
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { configureApp } from './app/setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await configureApp(app);
  const port = process.env['PORT'] || 3000;
  await app.listen(port);
  // Lets `nx serve` know the server is ready.
  if (process.env['NX_READY_SIGNAL_SOCKET']) {
    try {
      const load = new Function('s', 'return import(s)') as (
        s: string,
      ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
      (await load('@nx/js/ready-signal')).emitReadySignal(app.getHttpServer());
    } catch {
      // @nx/js isn't installed (production image)
    }
  }
  Logger.log(
    `TrialMatch API on http://localhost:${port}/api (docs: /api/docs)`,
  );
}

bootstrap();
