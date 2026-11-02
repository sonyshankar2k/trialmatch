import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/app/db/schema.ts',
  out: './src/app/db/migrations',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://trialmatch:trialmatch@localhost:5432/trialmatch',
  },
});
