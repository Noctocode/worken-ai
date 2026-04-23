import { Module } from '@nestjs/common';
import { ShortcutsController } from './shortcuts.controller.js';

@Module({
  controllers: [ShortcutsController],
})
export class ShortcutsModule {}
