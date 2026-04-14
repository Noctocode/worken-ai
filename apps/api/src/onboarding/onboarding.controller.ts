import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  OnboardingService,
  type OnboardingPayload,
} from './onboarding.service.js';

const MAX_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.getProfile(user.id);
  }

  @Post('complete')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async complete(
    @Body() body: { data?: string },
    @UploadedFiles() files: Express.Multer.File[] = [],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body?.data) {
      throw new BadRequestException('Missing "data" field in form body');
    }
    let payload: OnboardingPayload;
    try {
      payload = JSON.parse(body.data) as OnboardingPayload;
    } catch {
      throw new BadRequestException('"data" must be valid JSON');
    }

    await this.onboardingService.complete(user.id, payload, files);
    return { success: true };
  }
}
