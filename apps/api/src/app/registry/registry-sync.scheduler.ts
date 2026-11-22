import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Env } from '../config';
import { RegistrySyncService } from './registry-sync.service';

const QUEUE = 'registry-sync';
const DAY_MS = 24 * 60 * 60_000;

/**
 * Week 8: runs the registry sync on a schedule.
 * - With REDIS_URL: a BullMQ job scheduler (REGISTRY_SYNC_CRON), so the sync
 *   runs once per schedule however many API replicas or workers are up.
 * - Without it (local development, the single-container demo): every 24 hours
 *   in this process.
 * REGISTRY_SYNC_CRON=off turns both off; "Check now" still works.
 */
@Injectable()
export class RegistrySyncScheduler
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly log = new Logger('RegistrySync');
  private queue?: Queue;
  private worker?: Worker;
  private connections: Redis[] = [];
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly sync: RegistrySyncService,
  ) {}

  async onModuleInit() {
    const cron = this.config.get('REGISTRY_SYNC_CRON', { infer: true });
    if (cron === 'off') {
      this.log.log('Scheduled registry sync is off');
      return;
    }
    const url = this.config.get('REDIS_URL', { infer: true });
    if (!url) {
      this.timer = setInterval(() => void this.run(), DAY_MS);
      this.timer.unref();
      this.log.log(
        'Registry sync runs every 24 hours in-process (no REDIS_URL)',
      );
      return;
    }
    const connection = () => {
      const c = new Redis(url, { maxRetriesPerRequest: null });
      this.connections.push(c);
      return c;
    };
    this.queue = new Queue(QUEUE, { connection: connection() });
    await this.queue.upsertJobScheduler(
      'daily',
      { pattern: cron },
      { name: 'sync-all', opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.worker = new Worker(QUEUE, () => this.sync.syncAll(), {
      connection: connection(),
      concurrency: 1,
    });
    this.log.log(`Registry sync scheduled with BullMQ (${cron})`);
  }

  private async run() {
    try {
      await this.sync.syncAll();
    } catch (err) {
      this.log.warn(`Registry sync failed: ${String(err)}`);
    }
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
    for (const c of this.connections) c.disconnect();
  }
}
