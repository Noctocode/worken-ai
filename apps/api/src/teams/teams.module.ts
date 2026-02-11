import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [MailModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
