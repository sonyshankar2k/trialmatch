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
    .trim()
    .regex(
      /^postgres(ql)?:\/\/[^\s"']+$/,
      'must be one line starting with postgres:// or postgresql://, with no quotes or spaces',
    )
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
  /** Sign-in and sign-up attempts allowed per client per minute (slows password guessing). */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(10),
  // ---- Week 4: deployment ----
  /** Log level for the JSON request logs (pino): fatal, error, warn, info, debug, trace, silent. */
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  /**
   * How many proxies sit in front of the API (nginx, a cloud load balancer). Needed so
   * rate limits and logs see the real client address instead of the proxy's.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Serve the built React app from this folder (single-container deployment). */
  WEB_DIST_DIR: z.string().optional(),
  // ---- Week 2: AI matching ----
  /** Redis for the BullMQ job queue and live events. Without it, matching runs in-process. */
  REDIS_URL: z.string().optional(),
  /** "auto" uses Claude when ANTHROPIC_API_KEY is set, otherwise the rule-based engine. */
  MATCH_ENGINE: z.enum(['auto', 'claude', 'rules']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  /** How many candidate trials are assessed per run. */
  MATCH_MAX_TRIALS: z.coerce.number().int().min(1).max(20).default(5),
  /** Pause between trials so progress is visible in a demo. 0 in tests. */
  MATCH_STEP_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(0),
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
