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
  PatientCreateSchema,
  PatientListQuerySchema,
  PatientUpdateSchema,
  VersionSchema,
  type Page,
  type Patient,
} from '@trialmatch/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { createZodDto, IdParam } from '../common/zod';
import { PatientsService } from './patients.service';

class PatientListQuery extends createZodDto(PatientListQuerySchema) {}
class PatientCreateDto extends createZodDto(PatientCreateSchema) {}
class PatientUpdateDto extends createZodDto(PatientUpdateSchema) {}
class VersionQuery extends createZodDto(
  z.object({ version: z.coerce.number().pipe(VersionSchema) }),
) {}

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: PatientListQuery,
  ): Promise<Page<Patient>> {
    return this.patients.list(
      user.id,
      query as z.output<typeof PatientListQuerySchema>,
    );
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<Patient> {
    return this.patients.get(user.id, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: PatientCreateDto,
  ): Promise<Patient> {
    return this.patients.create(
      user.id,
      body as z.output<typeof PatientCreateSchema>,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Body() body: PatientUpdateDto,
  ): Promise<Patient> {
    return this.patients.update(
      user.id,
      id,
      body as z.output<typeof PatientUpdateSchema>,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Query() { version }: VersionQuery,
  ): Promise<void> {
    return this.patients.remove(user.id, id, version);
  }
}
