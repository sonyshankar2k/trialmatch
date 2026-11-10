import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  NctIdSchema,
  RegistryImportSchema,
  RegistrySearchQuerySchema,
  type RegistryPreview,
  type RegistrySearchResult,
  type Trial,
} from '@trialmatch/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { createZodDto } from '../common/zod';
import { RegistryService } from './registry.service';

class SearchQuery extends createZodDto(RegistrySearchQuerySchema) {}
class ImportBody extends createZodDto(RegistryImportSchema) {}
class NctParam extends createZodDto(z.object({ nctId: NctIdSchema })) {}

/**
 * ClinicalTrials.gov import. Each call reaches the public registry, so these
 * routes allow fewer requests per minute than the rest of the API.
 */
@ApiTags('registry')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('registry')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

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

  @Post('imports')
  import(
    @Body() { nctId }: ImportBody,
    @CurrentUser() user: AuthUser,
  ): Promise<Trial> {
    return this.registry.import(nctId, user.id);
  }
}
