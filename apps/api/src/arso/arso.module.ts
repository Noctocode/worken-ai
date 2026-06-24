import { Module } from '@nestjs/common';
import { ArsoController } from './arso.controller.js';
import { ArsoService } from './arso.service.js';
import { ArsoToolsService } from './arso-tools.service.js';

@Module({
  controllers: [ArsoController],
  providers: [ArsoService, ArsoToolsService],
  // Exported so the later chat tool-loop can list + dispatch ARSO tools.
  exports: [ArsoService, ArsoToolsService],
})
export class ArsoModule {}
