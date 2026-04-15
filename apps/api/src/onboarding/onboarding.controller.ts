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
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  OnboardingService,
  type OnboardingPayload,
} from './onboarding.service.js';

const MAX_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const UPLOAD_TMP_DIR = join(process.cwd(), 'uploads', 'tmp');
// Multer expects the destination to exist synchronously at import time.
mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

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
      // Stream to disk instead of buffering in RAM: 20 × 50MB = up to 1GB
      // per request. The service immediately moves the file into the
      // user's permanent directory and deletes the tmp copy.
      storage: diskStorage({
        destination: UPLOAD_TMP_DIR,
        filename: (_req, file, cb) => {
          // Keep the extension for sanity; the service writes its own
          // UUID-prefixed, sanitized final name into the user dir.
          const ext = file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}. Allowed: PDF, DOC, DOCX, TXT.`,
            ),
            false,
          );
        }
      },
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
