import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
