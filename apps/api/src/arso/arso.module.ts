import { Module } from '@nestjs/common';
import { ArsoController } from './arso.controller.js';
import { ArsoService } from './arso.service.js';

@Module({
  controllers: [ArsoController],
  providers: [ArsoService],
  // Exported so the later chat tool-loop can call ARSO data methods.
  exports: [ArsoService],
})
export class ArsoModule {}
