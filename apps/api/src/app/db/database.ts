import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Env } from '../config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export const DB = Symbol('DB');
export const InjectDb = () => Inject(DB);

/** Where the SQL migration files are, in development (src) and in the built image (dist). */
export const MIGRATIONS_DIR =
  process.env['MIGRATIONS_DIR'] ?? join(__dirname, 'migrations');

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(Pool) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 10,
        }),
    },
    {
      provide: DB,
      inject: [Pool],
      useFactory: (pool: Pool): Db =>
        drizzle(pool, { schema, casing: 'snake_case' }),
    },
    PoolCloser,
  ],
  exports: [DB, Pool],
})
export class DatabaseModule {}

/** Applies pending migrations. Holds an advisory lock so two replicas never migrate at once. */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(727274)')
      .catch(() => undefined);
    client.release();
  }
}

/** PostgreSQL error codes we turn into friendly responses. */
export const PG_UNIQUE_VIOLATION = '23505';
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  return e?.constraint ?? e?.cause?.constraint;
}
