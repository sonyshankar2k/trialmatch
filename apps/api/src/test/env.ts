/**
 * Test environment, loaded by Jest before any test file (setupFiles).
 * It must run before the app's modules are imported: ConfigModule reads and
 * validates the environment when AppModule is first loaded.
 */
process.env['DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://trialmatch:trialmatch@localhost:5432/trialmatch_test';
process.env['SEED_DEMO_DATA'] = 'false';
