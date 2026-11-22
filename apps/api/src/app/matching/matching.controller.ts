import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Sse,
  StreamableFile,
  type MessageEvent,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  MatchReviewSchema,
  type MatchResult,
  type MatchRun,
  type MatchRunEvent,
} from '@trialmatch/shared';
import { Observable } from 'rxjs';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { createZodDto, IdParam } from '../common/zod';
import { MatchingService } from './matching.service';
import { renderReferralPdf } from './referral-pdf';

class MatchReviewDto extends createZodDto(MatchReviewSchema) {}

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

  /** Week 7: screen your own patients for this trial, in the background (202 + the queued run). */
  @Post('trials/:id/match-runs')
  @HttpCode(202)
  startForTrial(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<MatchRun> {
    return this.matching.startForTrial(user.id, id);
  }

  @Get('trials/:id/match-runs')
  listForTrial(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<MatchRun[]> {
    return this.matching.listForTrial(user.id, id);
  }

  @Get('match-runs/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<MatchRun> {
    return this.matching.get(user.id, id);
  }

  /** Week 6: shortlist, dismiss or annotate one match (it is carried into later runs). */
  @Patch('match-results/:id')
  review(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Body() body: MatchReviewDto,
  ): Promise<MatchResult> {
    return this.matching.review(
      user.id,
      id,
      body as z.output<typeof MatchReviewSchema>,
    );
  }

  /** The shortlisted trials of the latest run as a PDF to send to the study teams. */
  @Get('patients/:id/referral.pdf')
  @ApiProduces('application/pdf')
  async referral(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<StreamableFile> {
    const referral = await this.matching.referral(user.id, id);
    const pdf = await renderReferralPdf(referral);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="referral-${referral.patient.pseudonym.replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`,
    });
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
