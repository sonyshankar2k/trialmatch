/**
 * Integration test harness: the real Nest app (guards, pipes, filters, migrations)
 * against a real PostgreSQL test database. Tables are emptied before each test.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthResponse } from '@trialmatch/shared';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/setup';

// The test database and other settings come from ./env.ts (Jest setupFiles).
if (!process.env['DATABASE_URL']?.includes('test')) {
  throw new Error(
    `Refusing to run tests against a non-test database: ${process.env['DATABASE_URL']}`,
  );
}

export interface TestContext {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  signUp: (email?: string) => Promise<{
    token: string;
    auth: Record<string, string>;
    user: AuthResponse['user'];
  }>;
}

export function useTestApp(): TestContext {
  const ctx = {} as TestContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    ctx.app = moduleRef.createNestApplication({ logger: false });
    await configureApp(ctx.app);
    await ctx.app.init();
    ctx.http = () => request(ctx.app.getHttpServer());
    let n = 0;
    ctx.signUp = async (email?: string) => {
      const res = await ctx
        .http()
        .post('/api/auth/register')
        .send({
          email: email ?? `user${++n}-${Date.now()}@test.dev`,
          displayName: 'Test User',
          password: 'correct-horse-battery',
        })
        .expect(201);
      const body = res.body as AuthResponse;
      return {
        token: body.accessToken,
        auth: { Authorization: `Bearer ${body.accessToken}` },
        user: body.user,
      };
    };
  });

  beforeEach(async () => {
    await ctx.app
      .get(Pool)
      .query(
        'TRUNCATE trial_criteria, trials, patients, users RESTART IDENTITY CASCADE',
      );
  });

  afterAll(async () => {
    await ctx.app?.close();
  });

  return ctx;
}
