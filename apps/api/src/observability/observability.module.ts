import { Global, Module } from '@nestjs/common';
import { ObservabilityService } from './observability.service.js';

/**
 * Global so any feature module can inject ObservabilityService without
 * having to add the module to its own imports list.
 */
@Global()
@Module({
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
