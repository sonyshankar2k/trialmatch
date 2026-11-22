import {
  Global,
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuditContextMiddleware } from './audit-context';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/** Week 9: global, so every feature module can record events. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AdminGuard],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuditContextMiddleware)
      .forRoutes({ path: '{/*splat}', method: RequestMethod.ALL });
  }
}
