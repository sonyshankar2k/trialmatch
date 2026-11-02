import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Public } from './auth/public.decorator';
import { InjectDb } from './db/database';
import type { Db } from './db/database';

@ApiTags('ops')
@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Liveness + database reachability (used by Docker and Kubernetes probes). */
  @Public()
  @Get()
  async health(): Promise<{ status: 'ok' }> {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
