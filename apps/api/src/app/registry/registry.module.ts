import { Module } from '@nestjs/common';
import { TrialsModule } from '../trials/trials.module';
import { CtgovClient } from './ctgov.client';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

@Module({
  imports: [TrialsModule],
  controllers: [RegistryController],
  providers: [CtgovClient, RegistryService],
})
export class RegistryModule {}
