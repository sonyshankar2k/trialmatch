import { z } from 'zod';

/**
 * Environment variables, validated once at startup. A missing or malformed
 * value stops the app immediately with a clear message instead of failing later.
 */
export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z
    .string()
    .default('postgres://trialmatch:trialmatch@localhost:5432/trialmatch'),
  // Local development only. Set a long random value anywhere real (openssl rand -hex 32).
  JWT_SECRET: z
    .string()
    .min(32)
    .default('dev-only-change-me-0123456789abcdef0123456789'),
  JWT_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(8 * 60 * 60),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    throw new Error(
      `Invalid environment variables:\n  ${problems.join('\n  ')}`,
    );
  }
  return parsed.data;
}
