import { Logger } from '@nestjs/common';
import type { MatchRun } from '@trialmatch/shared';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';

/**
 * Live progress of match runs. The worker publishes, the SSE endpoint listens.
 * With Redis, events cross processes (API replicas and separate workers);
 * without it, they stay in this process.
 */
export abstract class MatchEvents {
  protected readonly local = new EventEmitter().setMaxListeners(0);

  abstract publish(run: MatchRun): Promise<void>;

  /** Returns an unsubscribe function. */
  subscribe(runId: number, listener: (run: MatchRun) => void): () => void {
    const key = `run:${runId}`;
    this.local.on(key, listener);
    return () => this.local.off(key, listener);
  }

  async close(): Promise<void> {
    this.local.removeAllListeners();
  }
}

export class InMemoryMatchEvents extends MatchEvents {
  async publish(run: MatchRun): Promise<void> {
    this.local.emit(`run:${run.id}`, run);
  }
}

const CHANNEL = 'trialmatch:match-runs';

export class RedisMatchEvents extends MatchEvents {
  private readonly log = new Logger(RedisMatchEvents.name);
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(url: string) {
    super();
    this.pub = new Redis(url, { lazyConnect: false });
    this.sub = new Redis(url);
    void this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_channel, message) => {
      try {
        const run = JSON.parse(message) as MatchRun;
        this.local.emit(`run:${run.id}`, run);
      } catch {
        this.log.warn('Ignored a malformed match event');
      }
    });
  }

  async publish(run: MatchRun): Promise<void> {
    await this.pub.publish(CHANNEL, JSON.stringify(run));
  }

  override async close(): Promise<void> {
    await super.close();
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
