import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { ApiExceptionFilter } from './common/errors';
import { validateEnv } from './config';
import { DatabaseModule } from './db/database';
import { HealthController } from './health.controller';
import { MatchingModule } from './matching/matching.module';
import { PatientsModule } from './patients/patients.module';
import { TrialsModule } from './trials/trials.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // 300 requests per minute per client by default; auth routes are stricter.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    // One JSON log line per request, with a request id (taken from X-Request-Id
    // when a proxy sets it). Readable output in development.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        genReqId: (req, res) => {
          const id =
            (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        // Keep log lines short: no headers (so no tokens or cookies), just what's useful.
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({
            statusCode: res.statusCode,
          }),
        },
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        transport:
          process.env['NODE_ENV'] === 'development' &&
          process.env['LOG_PRETTY'] !== 'false'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    DatabaseModule,
    AuthModule,
    TrialsModule,
    PatientsModule,
    MatchingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe }, // validates every body/query/param DTO
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
