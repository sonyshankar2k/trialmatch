import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { MatchRun, MatchRunEvent } from '@trialmatch/shared';
import { Observable } from 'rxjs';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { IdParam } from '../common/zod';
import { MatchingService } from './matching.service';

const isFinished = (run: MatchRun) =>
  run.status === 'succeeded' || run.status === 'failed';

@ApiTags('matching')
@ApiBearerAuth()
@Controller()
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  /** Starts matching in the background: 202 + the queued run. Follow it with /events. */
  @Post('patients/:id/match-runs')
  @HttpCode(202)
  start(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<MatchRun> {
    return this.matching.start(user.id, id);
  }

  @Get('patients/:id/match-runs')
  list(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<MatchRun[]> {
    return this.matching.listForPatient(user.id, id);
  }

  @Get('match-runs/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<MatchRun> {
    return this.matching.get(user.id, id);
  }

  /**
   * Live progress as Server-Sent Events. Sends the current state first, then every
   * change, and ends when the run finishes. A comment-free "ping" every 15s keeps
   * proxies from closing an idle connection.
   */
  @Sse('match-runs/:id/events')
  @Header('X-Accel-Buffering', 'no') // tell nginx not to buffer the stream
  async events(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<Observable<MessageEvent>> {
    // Check access before the stream starts, so a stranger gets a real 404 (not a 200 stream).
    await this.matching.get(user.id, id);
    return new Observable<MessageEvent>((subscriber) => {
      let done = false;
      const send = (run: MatchRun) => {
        if (done) return;
        subscriber.next({ data: { type: 'run', run } satisfies MatchRunEvent });
        if (isFinished(run)) {
          done = true;
          subscriber.complete();
        }
      };
      // Listen first, then read the current state, so no update can fall in between.
      const unsubscribe = this.matching.subscribe(id, send);
      this.matching.get(user.id, id).then(send, (err) => subscriber.error(err));
      const ping = setInterval(
        () => subscriber.next({ data: { type: 'ping' } }),
        15_000,
      );
      return () => {
        done = true;
        clearInterval(ping);
        unsubscribe();
      };
    });
  }
}
