import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  AuditQuerySchema,
  type AuditEvent,
  type Page,
} from '@trialmatch/shared';
import type { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { createZodDto, IdParam } from '../common/zod';
import { AuditService } from './audit.service';

class AuditQueryDto extends createZodDto(AuditQuerySchema) {}
type Query_ = z.output<typeof AuditQuerySchema>;

/** Week 9: the audit trail. The full log is for administrators; each record's history for those who can see the record. */
@ApiTags('audit')
@ApiBearerAuth()
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit')
  @UseGuards(AdminGuard)
  list(@Query() query: AuditQueryDto): Promise<Page<AuditEvent>> {
    return this.audit.list(query as Query_);
  }

  /** The filtered log as a CSV file. The export is recorded in the log. */
  @Get('audit/export.csv')
  @UseGuards(AdminGuard)
  @ApiProduces('text/csv')
  async export(@Query() query: AuditQueryDto): Promise<StreamableFile> {
    const csv = await this.audit.exportCsv(query as Query_);
    const day = new Date().toISOString().slice(0, 10);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="audit-log-${day}.csv"`,
    });
  }

  @Get('patients/:id/history')
  patientHistory(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<AuditEvent[]> {
    return this.audit.patientHistory(user.id, id);
  }

  @Get('trials/:id/history')
  trialHistory(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<AuditEvent[]> {
    return this.audit.trialHistory(user.id, id);
  }
}
