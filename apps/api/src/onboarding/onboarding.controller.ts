import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Response as ExpressResponse } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  OnboardingService,
  type OnboardingDraft,
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

  /**
   * Edit the company-profile fields after onboarding completes.
   * Drives the Company tab Pencil flow — keeps the displayed values
   * (companyName / industry / teamSize, plus optional display name)
   * mutable without re-running the full wizard. Service rejects
   * non-company accounts and re-validates the dropdown enums.
   */
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      name?: string;
      companyName?: string;
      industry?: string;
      teamSize?: string;
    },
  ) {
    return this.onboardingService.updateProfile(user.id, body ?? {});
  }

  /**
   * Resume-flow draft endpoints. The wizard PATCHes its scalar
   * fields after each Continue so a user who closes the tab can
   * pick up where they left off on next login. The row is per-user
   * (PK = userId) and is dropped once `complete` succeeds.
   */
  @Get('draft')
  getDraft(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService
      .getDraft(user.id)
      .then((draft) => ({ draft }));
  }

  @Patch('draft')
  updateDraft(
    @Body() body: OnboardingDraft,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingService
      .updateDraft(user.id, body ?? {})
      .then((draft) => ({ draft }));
  }

  @Delete('draft')
  @HttpCode(204)
  async deleteDraft(@CurrentUser() user: AuthenticatedUser) {
    await this.onboardingService.deleteDraft(user.id);
  }

  @Get('documents/:id/download')
  async downloadDocument(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: false }) res: ExpressResponse,
  ) {
    const { stream, filename, mimeType } =
      await this.onboardingService.openDocumentForUser(id, user.id);
    // RFC 5987 filename* for non-ASCII names; plain filename= for legacy
    // clients. Quotes around the filename are escaped defensively.
    const safeAscii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(
        filename,
      )}`,
    );
    stream.pipe(res);
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
