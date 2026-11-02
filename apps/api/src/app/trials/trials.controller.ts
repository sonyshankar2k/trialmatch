import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  TrialCreateSchema,
  TrialListQuerySchema,
  TrialUpdateSchema,
  VersionSchema,
  type Page,
  type Trial,
  type TrialSummary,
} from '@trialmatch/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { createZodDto, IdParam } from '../common/zod';
import { TrialsService } from './trials.service';

class TrialListQuery extends createZodDto(TrialListQuerySchema) {}
class TrialCreateDto extends createZodDto(TrialCreateSchema) {}
class TrialUpdateDto extends createZodDto(TrialUpdateSchema) {}
class VersionQuery extends createZodDto(
  z.object({ version: z.coerce.number().pipe(VersionSchema) }),
) {}

@ApiTags('trials')
@ApiBearerAuth()
@Controller('trials')
export class TrialsController {
  constructor(private readonly trials: TrialsService) {}

  @Get()
  list(@Query() query: TrialListQuery): Promise<Page<TrialSummary>> {
    return this.trials.list(query as z.output<typeof TrialListQuerySchema>);
  }

  @Get(':id')
  get(@Param() { id }: IdParam): Promise<Trial> {
    return this.trials.get(id);
  }

  @Post()
  create(
    @Body() body: TrialCreateDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Trial> {
    return this.trials.create(
      body as z.output<typeof TrialCreateSchema>,
      user.id,
    );
  }

  @Patch(':id')
  update(
    @Param() { id }: IdParam,
    @Body() body: TrialUpdateDto,
  ): Promise<Trial> {
    return this.trials.update(id, body as z.output<typeof TrialUpdateSchema>);
  }

  /** `?version=` must match, so a stale page can't delete a trial someone just edited. */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param() { id }: IdParam,
    @Query() { version }: VersionQuery,
  ): Promise<void> {
    return this.trials.remove(id, version);
  }
}
