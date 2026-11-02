import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

/** How a run reaches a worker. */
export abstract class MatchQueue {
  abstract enqueue(runId: number): Promise<void>;
  async close(): Promise<void> {
    // nothing to release by default
  }
}

export const MATCH_QUEUE_NAME = 'matching';
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = 5_000;

/** Production: a BullMQ job in Redis, retried with exponential backoff (5s, 10s). */
export class BullMqMatchQueue extends MatchQueue {
  constructor(private readonly queue: Queue) {
    super();
  }

  async enqueue(runId: number): Promise<void> {
    await this.queue.add(
      'match-patient',
      { runId },
      {
        jobId: `run-${runId}`, // one job per run, even if enqueued twice
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  override async close(): Promise<void> {
    await this.queue.close();
  }
}

/** No Redis (local development, tests): run in this process, with the same retry policy. */
export class InlineMatchQueue extends MatchQueue {
  private readonly log = new Logger(InlineMatchQueue.name);
  readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly run: (
      runId: number,
      attempt: number,
    ) => Promise<'done' | 'retry'>,
    private readonly backoffMs = BACKOFF_MS,
  ) {
    super();
  }

  async enqueue(runId: number): Promise<void> {
    const work = (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if ((await this.run(runId, attempt)) === 'done') return;
        await new Promise((r) =>
          setTimeout(r, this.backoffMs * 2 ** (attempt - 1)),
        );
      }
    })().catch((err) => this.log.error(err));
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  /** Tests: wait until every queued run has finished. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
}
