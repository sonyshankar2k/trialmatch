import { Module } from '@nestjs/common';
import { TrialsModule } from '../trials/trials.module';
import { CtgovClient } from './ctgov.client';
import { RegistrySyncScheduler } from './registry-sync.scheduler';
import { RegistrySyncService } from './registry-sync.service';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

@Module({
  imports: [TrialsModule],
  controllers: [RegistryController],
  providers: [
    CtgovClient,
    RegistryService,
    RegistrySyncService,
    RegistrySyncScheduler,
  ],
})
export class RegistryModule {}
