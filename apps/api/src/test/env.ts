/**
 * Test environment, loaded by Jest before any test file (setupFiles).
 * It must run before the app's modules are imported: ConfigModule reads and
 * validates the environment when AppModule is first loaded.
 */
process.env['DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://trialmatch:trialmatch@localhost:5432/trialmatch_test';
process.env['SEED_DEMO_DATA'] = 'false';
// Tests sign up many users; the rate-limit test lowers this itself.
process.env['AUTH_RATE_LIMIT_PER_MINUTE'] = '1000';
// Matching runs in-process with the rule-based engine (no Redis, no API key needed).
delete process.env['REDIS_URL'];
process.env['MATCH_ENGINE'] = 'rules';
process.env['LOG_LEVEL'] = 'silent';
