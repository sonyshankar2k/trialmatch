import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  NctIdSchema,
  RegistryImportSchema,
  RegistrySearchQuerySchema,
  TrialUpdateApplySchema,
  TrialUpdateDismissSchema,
  type RegistryPreview,
  type RegistrySearchResult,
  type RegistrySyncResult,
  type PendingTrialUpdate,
  type Trial,
} from '@trialmatch/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { createZodDto, IdParam } from '../common/zod';
import { RegistrySyncService } from './registry-sync.service';
import { RegistryService } from './registry.service';

class SearchQuery extends createZodDto(RegistrySearchQuerySchema) {}
class ImportBody extends createZodDto(RegistryImportSchema) {}
class NctParam extends createZodDto(z.object({ nctId: NctIdSchema })) {}
class ApplyBody extends createZodDto(TrialUpdateApplySchema) {}
class DismissBody extends createZodDto(TrialUpdateDismissSchema) {}

/**
 * ClinicalTrials.gov import. Each call reaches the public registry, so these
 * routes allow fewer requests per minute than the rest of the API.
 */
@ApiTags('registry')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('registry')
export class RegistryController {
  constructor(
    private readonly registry: RegistryService,
    private readonly sync_: RegistrySyncService,
  ) {}

  /** Search ClinicalTrials.gov (interventional studies, 10 per page). */
  @Get('studies')
  search(@Query() query: SearchQuery): Promise<RegistrySearchResult> {
    return this.registry.search(
      query as z.output<typeof RegistrySearchQuerySchema>,
    );
  }

  /** How a study would look as a TrialMatch trial, with warnings. Nothing is saved. */
  @Get('studies/:nctId')
  preview(@Param() { nctId }: NctParam): Promise<RegistryPreview> {
    return this.registry.preview(nctId);
  }

  /** Week 8: check every imported trial against the registry now. */
  @Post('sync')
  @HttpCode(200)
  sync(): Promise<RegistrySyncResult> {
    return this.sync_.syncAll();
  }

  /** Week 8: check one imported trial now. `update` is null when it is in step. */
  @Post('trials/:id/check')
  @HttpCode(200)
  async check(@Param() { id }: IdParam): Promise<PendingTrialUpdate> {
    return { update: await this.sync_.checkTrial(id) };
  }

  @Get('trials/:id/update')
  async pending(@Param() { id }: IdParam): Promise<PendingTrialUpdate> {
    return { update: await this.sync_.pending(id) };
  }

  /** Take the registry's changes. Carries the update revision and trial version read: 409 if stale. */
  @Post('updates/:id/apply')
  @HttpCode(200)
  apply(
    @Param() { id }: IdParam,
    @Body() { revision, version }: ApplyBody,
    @CurrentUser() user: AuthUser,
  ): Promise<Trial> {
    return this.sync_.apply(id, revision, version, user.id);
  }

  /** Keep the trial as it is; the registry's version counts as seen. Carries the revision reviewed. */
  @Post('updates/:id/dismiss')
  @HttpCode(200)
  dismiss(
    @Param() { id }: IdParam,
    @Body() { revision }: DismissBody,
    @CurrentUser() user: AuthUser,
  ): Promise<Trial> {
    return this.sync_.dismiss(id, revision, user.id);
  }

  @Post('imports')
  import(
    @Body() { nctId }: ImportBody,
    @CurrentUser() user: AuthUser,
  ): Promise<Trial> {
    return this.registry.import(nctId, user.id);
  }
}
