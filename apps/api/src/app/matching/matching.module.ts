import {
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Env } from '../config';
import { DB, type Db } from '../db/database';
import { createEngine } from './engines';
import { InMemoryMatchEvents, MatchEvents, RedisMatchEvents } from './events';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import {
  BullMqMatchQueue,
  InlineMatchQueue,
  MATCH_QUEUE_NAME,
  MatchQueue,
} from './queue';
import { MatchRunner } from './runner';

/**
 * With REDIS_URL: runs go through a BullMQ queue and a worker (in this process,
 * or in separate worker processes with the same image), and progress events
 * travel through Redis pub/sub so any API replica can stream them.
 * Without it: everything runs in this process (local development, tests).
 */
@Injectable()
class MatchingInfrastructure implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Matching');
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly events: MatchEvents,
    private readonly runner: MatchRunner,
    private readonly matchQueue: MatchQueue,
  ) {}

  onModuleInit() {
    const url = this.config.get('REDIS_URL', { infer: true });
    if (!url || !(this.matchQueue instanceof BullMqMatchQueue)) {
      this.log.log(
        `Matching runs in-process (engine: ${this.runner.engineName})`,
      );
      return;
    }
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      MATCH_QUEUE_NAME,
      async (job) => {
        const outcome = await this.runner.run(
          job.data.runId,
          job.attemptsMade + 1,
        );
        if (outcome === 'retry')
          throw new Error('Transient failure; BullMQ retries with backoff');
      },
      { connection: this.connection, concurrency: 4 },
    );
    this.worker.on('failed', (job, err) =>
      this.log.warn(`Job ${job?.id} attempt failed: ${err.message}`),
    );
    this.log.log(
      `Matching worker started on queue "${MATCH_QUEUE_NAME}" (engine: ${this.runner.engineName})`,
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close(); // finishes the job in progress first
    await this.matchQueue.close();
    await this.events.close();
    this.connection?.disconnect();
  }
}

@Module({
  controllers: [MatchingController],
  providers: [
    MatchingService,
    {
      provide: MatchEvents,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('REDIS_URL', { infer: true });
        return url ? new RedisMatchEvents(url) : new InMemoryMatchEvents();
      },
    },
    {
      provide: MatchRunner,
      inject: [ConfigService, DB, MatchEvents],
      useFactory: (
        config: ConfigService<Env, true>,
        db: Db,
        events: MatchEvents,
      ) =>
        new MatchRunner(db, createEngine(readEngineConfig(config)), events, {
          maxTrials: config.get('MATCH_MAX_TRIALS', { infer: true }),
          stepDelayMs: config.get('MATCH_STEP_DELAY_MS', { infer: true }),
        }),
    },
    {
      provide: MatchQueue,
      inject: [ConfigService, MatchRunner],
      useFactory: (config: ConfigService<Env, true>, runner: MatchRunner) => {
        const url = config.get('REDIS_URL', { infer: true });
        if (!url)
          return new InlineMatchQueue((id, attempt) => runner.run(id, attempt));
        return new BullMqMatchQueue(
          new Queue(MATCH_QUEUE_NAME, {
            connection: new Redis(url, { maxRetriesPerRequest: null }),
          }),
        );
      },
    },
    MatchingInfrastructure,
  ],
})
export class MatchingModule {}

function readEngineConfig(config: ConfigService<Env, true>) {
  return {
    MATCH_ENGINE: config.get('MATCH_ENGINE', { infer: true }),
    ANTHROPIC_API_KEY: config.get('ANTHROPIC_API_KEY', { infer: true }),
    ANTHROPIC_MODEL: config.get('ANTHROPIC_MODEL', { infer: true }),
  };
}
