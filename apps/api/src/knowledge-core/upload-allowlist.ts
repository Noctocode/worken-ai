import { BadRequestException } from '@nestjs/common';

/**
 * Allowlist for files the user can upload into the knowledge ingestion
 * pipeline. Word (.doc, .docx), Excel (.xls, .xlsx) and PDF (.pdf) —
 * the only formats `DocumentsService.parseFile` (and downstream chunk
 * + embed) can produce searchable text for since image OCR was
 * removed from the app.
 *
 * Owned here so both knowledge-core's own upload endpoint and the
 * project-scoped chat upload (`projects.controller`) enforce the same
 * contract. A regression in either would let an image through and end
 * with a misleading "Skipped" badge instead of a clean rejection.
 *
 * Why a single regex pair instead of arrays of literal extensions:
 *   - `application/octet-stream` is part of the mime allowlist because
 *     some browsers (and curl with no --mime-type) send that for
 *     .doc / .docx / .xls / .xlsx attachments. The extension test still
 *     enforces the real format, so this only widens the mime side.
 *   - extension test is the authority; mime test is a soft second
 *     gate. Both must pass.
 */
export const UPLOAD_ALLOWED_EXTENSIONS = /\.(pdf|docx?|xlsx?)$/i;
export const UPLOAD_ALLOWED_MIMETYPES =
  /^application\/(pdf|msword|vnd\.openxmlformats|vnd\.ms-excel|octet-stream)/i;

/** Human-readable list of accepted formats — used in the rejection
 *  message so the user knows what to upload instead. */
export const UPLOAD_ALLOWED_LABEL =
  'Word (.doc, .docx), Excel (.xls, .xlsx), PDF (.pdf)';

/**
 * True when the file's name AND mimetype both satisfy the allowlist.
 * Image-bearing names (.png, .jpg, …) or mime types (image/*) return
 * false; so do unrelated formats (.zip, .mp4, …).
 */
export function isUploadAllowed(filename: string, mimetype: string): boolean {
  return (
    UPLOAD_ALLOWED_EXTENSIONS.test(filename) &&
    UPLOAD_ALLOWED_MIMETYPES.test(mimetype)
  );
}

/**
 * Multer `fileFilter` adapter: rejects up front with a clear
 * BadRequestException, so the user sees a toast instead of an upload
 * landing in a `failed` row with a confusing "Skipped" badge.
 *
 * Multer aborts the whole multipart request when this fires for any
 * one file — that's the intended behavior: better to fail loudly on
 * a mixed batch than to silently drop one file.
 */
export function uploadFileFilter(
  _req: unknown,
  file: { originalname: string; mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!isUploadAllowed(file.originalname, file.mimetype)) {
    cb(
      new BadRequestException(
        `Unsupported file type: ${file.originalname}. ` +
          `Allowed: ${UPLOAD_ALLOWED_LABEL}.`,
      ),
      false,
    );
    return;
  }
  cb(null, true);
}
